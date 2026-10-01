#!/usr/bin/env node
// Dependency-free structural validation for the skills in .claude/skills/.
// Catches the failure modes that actually break a Claude skill:
//   1. Frontmatter that violates the Agent Skills spec
//      (https://agentskills.io/specification): a bad `name`, an over-long
//      `description`, an unknown field.
//   2. `name` disagreeing with the directory it sits in. Claude Code loads a
//      skill by directory, so a mismatch fails as "the skill never appears"
//      rather than as an error message. Here the directory is part of the repo,
//      so unlike a standalone skill repo this can be checked.
//   3. `metadata.version` drifting from the release badge in README.md; the
//      badge is static (private repo), so both numbers are hand-edited.
//   4. A relative Markdown link pointing at a file that doesn't exist.
//   5. An unquoted value that real YAML reads differently than this parser
//      does, e.g. `a: b` inside it. Claude Code then fails to load the whole
//      frontmatter and shows the skill with no description (happened in #29).
// The spec's own validator (agentskills/skills-ref) needs Python and uv; these
// are ~40 lines of regex, so they are reproduced here instead. Re-check against
// skills-ref by hand when cutting a release.
// Run with: node validate-skills.mjs   (exits non-zero on any failure)
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const skillsRoot = join(root, ".claude", "skills");
const errors = [];
const warnings = [];

// Spec limits, from https://agentskills.io/specification
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_COMPATIBILITY = 500;
// Descriptions grow when trigger wording is tuned; flag the squeeze before it
// becomes a hard failure mid-experiment. Set above the current longest on
// purpose: a warning that fires on every green run is one nobody reads.
const DESCRIPTION_WARN = 950;
// The spec's context recommendation. A warning, not an error: it is advice
// about what loads on every trigger, and these skills are well under it.
const RECOMMENDED_LINES = 500;
const ALLOWED_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

// YAML's plain (unquoted) scalars cannot contain ": " (it starts a nested
// mapping, so the frontmatter fails to parse) and " #" starts a comment that
// silently truncates the value. This parser is lenient about both, so they are
// checked explicitly. Returns the problem, or null for a safe or quoted value.
function plainScalarProblem(value) {
  if (/^["']/.test(value)) return null;
  if (/:(\s|$)/.test(value)) return 'contains ": " (quote the value or reword)';
  if (/\s#/.test(value)) return 'contains " #", which YAML reads as a comment';
  return null;
}
// Self-check, runs every time: the smallest thing that fails if the rule breaks.
for (const [v, bad] of [
  ["optional: without them", true],
  ["ends with a colon:", true],
  ["see issue #29", true],
  ['"quoted: fine"', false],
  ["https://agentskills.io/specification", false],
  ["optional; without them", false],
]) {
  if (!!plainScalarProblem(v) !== bad) throw new Error(`plainScalarProblem self-check failed on ${v}`);
}

// A frontmatter parser small enough to not warrant a YAML dependency. It covers
// exactly what the spec allows at the top level: plain scalars, folded/literal
// block scalars (`>` and `|`), and the one-level string map `metadata` uses.
// Anything it cannot classify is reported rather than skipped: a quietly
// dropped field is how a spec violation would slip past this check.
function parseFrontmatter(body, label) {
  const fields = {};
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) {
      i++;
      continue;
    }
    const top = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!top) {
      errors.push(`${label}: cannot parse frontmatter line "${line.trim()}"`);
      i++;
      continue;
    }
    const [, key, inline] = top;
    i++;
    // Collect the indented block belonging to this key, whatever its shape.
    const block = [];
    while (i < lines.length && (/^[ \t]+\S/.test(lines[i]) || !lines[i].trim())) {
      block.push(lines[i]);
      i++;
    }
    if (inline === ">" || inline === "|" || inline === ">-" || inline === "|-") {
      // Folded scalars join with spaces; literal ones keep their newlines.
      const stripped = block.map((l) => l.replace(/^[ \t]+/, ""));
      fields[key] = inline.startsWith(">")
        ? stripped.filter((l) => l.trim()).join(" ")
        : stripped.join("\n").trim();
    } else if (inline !== "") {
      const problem = plainScalarProblem(inline);
      if (problem) errors.push(`${label}: "${key}" ${problem}`);
      fields[key] = inline.replace(/^["']|["']$/g, "");
    } else {
      const map = {};
      for (const entry of block) {
        if (!entry.trim()) continue;
        const pair = /^[ \t]+([A-Za-z0-9_.-]+):[ \t]*(.*)$/.exec(entry);
        if (!pair) {
          errors.push(`${label}: cannot parse "${key}" entry "${entry.trim()}"`);
          continue;
        }
        const problem = plainScalarProblem(pair[2]);
        if (problem) errors.push(`${label}: "${key}.${pair[1]}" ${problem}`);
        map[pair[1]] = pair[2].replace(/^["']|["']$/g, "");
      }
      fields[key] = map;
    }
  }
  return fields;
}

// The one number the README badge is checked against. All skills in this repo
// ship together and are versioned with the repo, so they all carry the same
// value; a per-skill version would drift with nothing reading it.
function readmeVersion() {
  const readmePath = join(root, "README.md");
  if (!existsSync(readmePath)) {
    errors.push("README.md is missing, so no release badge to check against");
    return undefined;
  }
  const readme = readFileSync(readmePath, "utf8");
  const badge = /img\.shields\.io\/badge\/release-v([0-9]+\.[0-9]+\.[0-9]+)-/.exec(readme);
  if (!badge) {
    errors.push("README.md has no release badge to check metadata.version against");
    return undefined;
  }
  return badge[1];
}

function validateSkill(dir) {
  const name = basename(dir);
  const skillPath = join(dir, "SKILL.md");
  const label = `.claude/skills/${name}/SKILL.md`;
  if (!existsSync(skillPath)) {
    errors.push(`${label} is missing`);
    return null;
  }
  // Strip a leading BOM and blank lines: both are common from Windows editors
  // and would otherwise miss the anchored regex below, reporting a valid
  // frontmatter block as "no frontmatter".
  const text = readFileSync(skillPath, "utf8").replace(/^﻿/, "").replace(/^\s*\n+/, "");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) {
    errors.push(`${label} has no YAML frontmatter block`);
    return null;
  }
  // A second frontmatter block right after the first is a real failure mode:
  // an importer that renames a skill can prepend a new block and leave the
  // original in place, where it renders as body text and the reader sees two
  // names. One was found in an installed third-party skill; cheap to check.
  const afterFm = text.slice(fm[0].length).replace(/^\s*\n+/, "");
  if (/^---\r?\n/.test(afterFm)) {
    errors.push(`${label}: a second frontmatter block follows the first`);
  }

  const fields = parseFrontmatter(fm[1], label);

  for (const key of ["name", "description"]) {
    if (!(key in fields)) errors.push(`${label} frontmatter is missing "${key}:"`);
  }
  for (const key of Object.keys(fields)) {
    if (!ALLOWED_FIELDS.has(key)) {
      errors.push(
        `${label} frontmatter has unknown field "${key}" (spec allows: ${[...ALLOWED_FIELDS].join(", ")})`,
      );
    }
  }

  const declared = fields.name;
  if (typeof declared === "string") {
    if (!declared.length || declared.length > MAX_NAME) {
      errors.push(`${label} "name" must be 1-${MAX_NAME} characters (is ${declared.length})`);
    }
    if (declared !== declared.toLowerCase()) {
      errors.push(`${label} "name" must be lowercase (is "${declared}")`);
    }
    if (!/^[a-z0-9-]*$/.test(declared)) {
      errors.push(
        `${label} "name" may only contain lowercase letters, digits and hyphens (is "${declared}")`,
      );
    }
    if (declared.startsWith("-") || declared.endsWith("-")) {
      errors.push(`${label} "name" cannot start or end with a hyphen`);
    }
    if (declared.includes("--")) {
      errors.push(`${label} "name" cannot contain consecutive hyphens`);
    }
    if (declared !== name) {
      errors.push(`${label} "name" (${declared}) does not match its directory (${name})`);
    }
  } else if (declared !== undefined) {
    errors.push(`${label} "name" must be a string`);
  }

  const description = fields.description;
  if (typeof description === "string") {
    if (!description.trim()) {
      errors.push(`${label} "description" must not be empty`);
    } else if (description.length > MAX_DESCRIPTION) {
      errors.push(
        `${label} "description" exceeds the ${MAX_DESCRIPTION}-character limit (is ${description.length})`,
      );
    } else if (description.length > DESCRIPTION_WARN) {
      warnings.push(
        `${label} "description" is ${description.length} of ${MAX_DESCRIPTION} characters, little room left for trigger tuning`,
      );
    }
  } else if (description !== undefined) {
    errors.push(`${label} "description" must be a string`);
  }

  const compatibility = fields.compatibility;
  if (typeof compatibility === "string" && compatibility.length > MAX_COMPATIBILITY) {
    errors.push(
      `${label} "compatibility" exceeds the ${MAX_COMPATIBILITY}-character limit (is ${compatibility.length})`,
    );
  }

  const metadata = fields.metadata;
  if (metadata !== undefined) {
    if (typeof metadata !== "object" || Array.isArray(metadata)) {
      errors.push(`${label} "metadata" must be a map of string keys to string values`);
    } else {
      for (const [k, v] of Object.entries(metadata)) {
        if (typeof v !== "string") errors.push(`${label} "metadata.${k}" must be a string`);
      }
    }
  }

  const lines = text.split(/\r?\n/).length;
  if (lines > RECOMMENDED_LINES) {
    warnings.push(
      `${label} is ${lines} lines, above the ${RECOMMENDED_LINES}-line recommendation: everything here loads on every trigger`,
    );
  }

  return { name, fields, skillPath };
}

// Relative Markdown links, checked per skill file. Fenced code blocks are
// stripped first: the skills quote shell commands containing brackets, which
// would otherwise match the link regex.
function checkLinks(skillPath, label) {
  const text = readFileSync(skillPath, "utf8").replace(/```[\s\S]*?```/g, "");
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = linkRe.exec(text))) {
    const target = m[1].trim().split("#")[0];
    if (!target || /^(https?:|mailto:|#)/.test(m[1].trim())) continue;
    // A leading ~ is a home-directory path, not a repo-relative link.
    if (target.startsWith("~")) continue;
    if (!existsSync(resolve(dirname(skillPath), target))) {
      errors.push(`${label}: broken link -> ${m[1]}`);
    }
  }
}

if (!existsSync(skillsRoot)) {
  console.error(`No skills directory at ${skillsRoot}`);
  process.exit(1);
}

const dirs = readdirSync(skillsRoot)
  .map((entry) => join(skillsRoot, entry))
  .filter((full) => statSync(full).isDirectory())
  .sort();

if (!dirs.length) {
  console.error(`No skills found under ${skillsRoot}`);
  process.exit(1);
}

const expectedVersion = readmeVersion();
for (const dir of dirs) {
  const skill = validateSkill(dir);
  if (!skill) continue;
  checkLinks(skill.skillPath, `.claude/skills/${skill.name}/SKILL.md`);
  const metadata = skill.fields.metadata;
  const version = typeof metadata === "object" && metadata ? metadata.version : undefined;
  if (version === undefined) {
    errors.push(`.claude/skills/${skill.name}/SKILL.md is missing "metadata.version"`);
  } else if (expectedVersion !== undefined && version !== expectedVersion) {
    errors.push(
      `.claude/skills/${skill.name}/SKILL.md metadata.version (${version}) does not match the README release badge (${expectedVersion})`,
    );
  }
}

// Warnings print either way: they flag a limit being approached, which is worth
// seeing on a green run and must not fail CI on its own.
for (const w of warnings) console.warn("Warning: " + w);

if (errors.length) {
  console.error("Skill validation FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`Skill validation passed (${dirs.length} skills).`);
