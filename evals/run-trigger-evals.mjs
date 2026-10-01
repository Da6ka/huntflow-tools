#!/usr/bin/env node
// Trigger-only evals for the skills in this repo.
//
// The question this answers is narrow on purpose: given a recruiter's sentence,
// which skill does Claude pick? The two skills here (add people to the ATS, load
// website applications) sit side by side. A description that pulls the other's
// work is the expensive failure: huntflow-add writes to a live ATS.
//
// Nothing here grades output quality, so there is no judge and no rubric. The
// verdict comes from the tool trace: which `Skill` the CLI actually invoked.
// That is deterministic, which a judge's reading of prose is not.
//
// Safety: every eval run is started with Bash, Write, Edit and the web tools
// withheld, so a skill can be chosen but cannot act. No run can reach the
// Huntflow API, and no ATS record is created by a measurement.
//
// Usage:
//   node evals/run-trigger-evals.mjs --dry                   list cases, spend nothing
//   node evals/run-trigger-evals.mjs                         one run per case
//   node evals/run-trigger-evals.mjs --runs 3                a trigger rate per case
//   node evals/run-trigger-evals.mjs --case add-cv-file      one case
//
// Writes evals/trigger-benchmark.json (gitignored): per-case rate, which skill
// fired instead when it was the wrong one, and the CLI's own cost figure.
import { spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  existsSync,
  symlinkSync,
  cpSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(EVAL_DIR);
const SKILLS_DIR = join(REPO_ROOT, ".claude", "skills");
const CASES = join(EVAL_DIR, "trigger-cases.csv");

// The generated plugin the CLI loads the skills from, and the prefix the CLI
// then names them by. Pinning matters for the same reason it does in the
// skill-eval harnesses generally: an installed or synced copy would otherwise answer,
// and the measurement would describe a file nobody here just edited.
const PIN_PLUGIN = "huntflow-skills-eval";

const EVAL_MODEL = process.env.EVAL_MODEL || "opus";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

// Withheld from every run: a chosen skill must not be able to act. Bash covers
// huntflow.js and add_applicant.py, which is what would reach the live ATS.
const DISALLOWED = ["Bash", "Write", "Edit", "WebSearch", "WebFetch"];

// A trigger lands in the first assistant turn in print mode (there is no user
// to answer a clarifying question), so the run is capped short. The cap is what
// keeps a triggered case from executing the whole workflow at full price.
//
// The cap cuts both ways, and only on the negative cases. A positive case is
// settled the moment the Skill call appears, cap or no cap. A negative case that
// ends *because* of the cap has not answered anything: the model may simply have
// spent its turns elsewhere: the first run of `none-funnel-report` went looking
// for Huntflow tooling with ToolSearch and Glob and never got to a decision.
// Those runs are reported as inconclusive rather than counted as non-triggers.
// Raise the cap with --max-turns to settle one.
const DEFAULT_MAX_TURNS = "2";

// A rate above this counts as "triggers", below as "does not", the convention
// the Agent Skills docs use.
const THRESHOLD = 0.5;

// --- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const DRY = flag("--dry");
const RUNS = Number(value("--runs", "1"));
const ONLY = (value("--case", "") || "").split(",").filter(Boolean);
const MAX_TURNS = value("--max-turns", DEFAULT_MAX_TURNS);
const OUT = value("--out", join(EVAL_DIR, "trigger-benchmark.json"));

// --- CSV -------------------------------------------------------------------
// Minimal RFC4180: quoted fields, "" escapes, commas inside quotes. One case
// per line; a newline inside a field is not supported.
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") {
        cells.push(cell);
        cell = "";
      } else cell += c;
    }
    cells.push(cell);
    rows.push(cells);
  }
  const [header, ...body] = rows;
  return body.map((cells) =>
    Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? "").trim()])),
  );
}

// --- the pinned plugin -----------------------------------------------------
// Symlinked where the platform allows it, copied where it does not. Only
// SKILL.md is copied in the fallback: these skills carry no reference files.
function buildPlugin(skillNames) {
  const dir = mkdtempSync(join(tmpdir(), `${PIN_PLUGIN}-`));
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify(
      {
        name: PIN_PLUGIN,
        description: "Working copies of the skills under test, for one eval run only.",
        version: "0.0.0",
      },
      null,
      2,
    ) + "\n",
  );
  mkdirSync(join(dir, "skills"), { recursive: true });
  for (const [name, source] of Object.entries(skillNames)) {
    const target = join(dir, "skills", name);
    try {
      symlinkSync(source, target, "dir");
    } catch {
      mkdirSync(target, { recursive: true });
      cpSync(join(source, "SKILL.md"), join(target, "SKILL.md"));
      const refs = join(source, "references");
      if (existsSync(refs)) cpSync(refs, join(target, "references"), { recursive: true });
    }
  }
  return dir;
}

// The skills under test: the two in this repo. A case that expects a skill that
// is not loaded cannot be graded (a missing skill cannot be chosen), so it is
// skipped and reported as skipped rather than counted as a pass.
function collectSkills() {
  const skills = {};
  for (const name of ["huntflow-add", "huntflow-site-applications"]) {
    const dir = join(SKILLS_DIR, name);
    if (existsSync(join(dir, "SKILL.md"))) skills[name] = dir;
  }
  return skills;
}

// --- CLI plumbing ----------------------------------------------------------
// cwd is a scratch directory, not the repo: this repo carries .claude/skills, and
// running from inside it would load the same skills a second time at
// project scope, so the trace could no longer say which copy answered.
function runClaude(prompt, pluginDir, cwd) {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    EVAL_MODEL,
    "--max-turns",
    MAX_TURNS,
    "--setting-sources",
    "project,local",
    "--disallowed-tools",
    ...DISALLOWED,
    "--plugin-dir",
    pluginDir,
  ];
  return new Promise((done) => {
    const child = spawn(CLAUDE_BIN, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => done({ out: "", err: String(e), code: 127 }));
    child.on("close", (code) => done({ out, err, code }));
    child.stdin.end(prompt);
  });
}

// Every Skill invocation in the transcript, plus the CLI's own cost figure.
// Unparseable lines are skipped: the CLI prints the occasional non-JSON warning
// and one should not sink a run.
function readStream(out) {
  const invoked = [];
  let costUsd;
  let isError = false;
  let stop = "";
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let e;
    try {
      e = JSON.parse(t);
    } catch {
      continue;
    }
    if (e.type === "assistant") {
      for (const b of e.message?.content ?? []) {
        if (b.type === "tool_use" && b.name === "Skill") {
          invoked.push(String(b.input?.skill ?? ""));
        }
      }
    } else if (e.type === "result") {
      if (typeof e.total_cost_usd === "number") costUsd = e.total_cost_usd;
      isError = Boolean(e.is_error);
      if (typeof e.subtype === "string") stop = e.subtype;
    }
  }
  return { invoked, costUsd, isError, stop };
}

// An id is `<plugin>:<name>`. Anything not carrying this run's plugin prefix is
// a foreign copy that shadowed the pinned one, and is reported as such rather
// than credited to the skill being measured.
function classify(invoked, expected, stop) {
  const pinned = invoked
    .filter((id) => id.startsWith(`${PIN_PLUGIN}:`))
    .map((id) => id.slice(PIN_PLUGIN.length + 1));
  const foreign = invoked.filter((id) => !id.startsWith(`${PIN_PLUGIN}:`));
  // Silence from a run the cap cut short is not a verdict; see DEFAULT_MAX_TURNS.
  const inconclusive = expected === "none" && !pinned.length && stop === "error_max_turns";
  const hit = expected === "none" ? pinned.length === 0 && !inconclusive : pinned.includes(expected);
  return { pinned, foreign, hit, inconclusive, stop };
}

// --- run -------------------------------------------------------------------
const cases = parseCsv(readFileSync(CASES, "utf8")).filter(
  (c) => !ONLY.length || ONLY.includes(c.id),
);
const skills = collectSkills();
const skipped = cases.filter((c) => c.expect !== "none" && !(c.expect in skills));
const runnable = cases.filter((c) => c.expect === "none" || c.expect in skills);

if (DRY) {
  for (const c of cases) {
    const mark = skipped.includes(c) ? "  [skipped: skill not loaded]" : "";
    console.log(`  ${c.id}  -> ${c.expect}${mark}`);
  }
  console.log(`\n${cases.length} cases, ${Object.keys(skills).length} skills loaded.`);
  process.exit(0);
}

const pluginDir = buildPlugin(skills);
const cwd = mkdtempSync(join(tmpdir(), "huntflow-eval-cwd-"));
const results = [];
let total = 0;

for (const c of runnable) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const { out, err, code } = await runClaude(c.prompt, pluginDir, cwd);
    const { invoked, costUsd, isError, stop } = readStream(out);
    if (code !== 0 && !invoked.length && stop !== "error_max_turns") {
      console.error(`  ${c.id} run ${i + 1}: CLI exited ${code}${err ? `: ${err.trim()}` : ""}`);
    }
    if (typeof costUsd === "number") total += costUsd;
    runs.push({ ...classify(invoked, c.expect, stop), costUsd, isError });
  }
  const hits = runs.filter((r) => r.hit).length;
  const unsettled = runs.filter((r) => r.inconclusive).length;
  const decided = runs.length - unsettled;
  // A rate over the runs that answered. All runs unsettled means no rate at all.
  const rate = decided ? hits / decided : null;
  const fired = [...new Set(runs.flatMap((r) => r.pinned))];
  const foreign = [...new Set(runs.flatMap((r) => r.foreign))];
  const verdict = rate === null ? "INCONCL" : rate > THRESHOLD ? "PASS" : "FAIL";
  const detail = c.expect === "none" ? fired.join(", ") : fired.filter((f) => f !== c.expect).join(", ");
  console.log(
    `  ${verdict}  ${c.id}  expected ${c.expect}, rate ${hits}/${decided || 0} of ${runs.length}` +
      (unsettled ? `  [${unsettled} cut short by the ${MAX_TURNS}-turn cap]` : "") +
      (detail ? `  (also fired: ${detail})` : "") +
      (foreign.length ? `  [foreign copy answered: ${foreign.join(", ")}]` : ""),
  );
  results.push({
    id: c.id,
    expect: c.expect,
    rate,
    hits,
    decided,
    runs: runs.length,
    inconclusive: unsettled || undefined,
    stops: runs.map((r) => r.stop || "ok"),
    fired,
    foreign,
    note: c.note,
  });
}

for (const c of skipped) {
  console.log(`  SKIP  ${c.id}  expected ${c.expect}, which is not loaded`);
  results.push({ id: c.id, expect: c.expect, skipped: true, note: c.note });
}

const failures = results.filter((r) => !r.skipped && r.rate !== null && r.rate <= THRESHOLD);
const unanswered = results.filter((r) => !r.skipped && r.rate === null);
writeFileSync(
  OUT,
  JSON.stringify(
    {
      taken_at: new Date().toISOString(),
      model: EVAL_MODEL,
      runs_per_case: RUNS,
      max_turns: Number(MAX_TURNS),
      skills_loaded: Object.keys(skills),
      cost_usd: total || undefined,
      cases: results,
    },
    null,
    2,
  ) + "\n",
);

console.log(
  `\n${results.length - skipped.length} cases run, ${failures.length} below threshold` +
    (total ? `, $${total.toFixed(2)}` : "") +
    `. Summary in ${OUT.replace(REPO_ROOT + "/", "")}.`,
);
if (skipped.length) console.log(`${skipped.length} skipped for want of a skill.`);
if (unanswered.length) {
  console.log(
    `${unanswered.length} answered nothing: every run hit the ${MAX_TURNS}-turn cap. Re-run those with --max-turns 5.`,
  );
}
// An unanswered case is not a green result, so it fails the run too: the point of
// the tool is a verdict, and "the cap cut it short" is not one.
process.exit(failures.length || unanswered.length ? 1 : 0);
