// Check both runtime directories and Codex UI metadata without live accounts.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "huntflow-skills-"));
const claude = join(root, ".claude/skills/sample-skill");
const codex = join(root, ".agents/skills/sample-skill");
const skill = `---
name: sample-skill
description: Use when checking a sample skill.
metadata:
  version: "1.9.0"
---
Sample instructions.
`;
const ui = `interface:
  display_name: "Sample Skill"
  short_description: "Check the sample intake workflow"
  default_prompt: "Use $sample-skill to prepare intake."
`;

function run() {
  const result = spawnSync(process.execPath, [join(root, "validate-skills.mjs")], { encoding: "utf8" });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

try {
  copyFileSync(new URL("./validate-skills.mjs", import.meta.url), join(root, "validate-skills.mjs"));
  writeFileSync(join(root, "README.md"), "https://img.shields.io/badge/release-v1.9.0-blue");
  mkdirSync(claude, { recursive: true });
  mkdirSync(join(codex, "agents"), { recursive: true });
  writeFileSync(join(claude, "SKILL.md"), skill);
  writeFileSync(join(codex, "SKILL.md"), skill);
  writeFileSync(join(codex, "agents/openai.yaml"), ui);

  let result = run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /2 skills/);

  writeFileSync(join(codex, "SKILL.md"), skill.replace('version: "1.9.0"', 'version: "0.0.0"'));
  result = run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output.replaceAll("\\", "/"), /\.agents\/skills\/sample-skill\/SKILL.md metadata.version/);
  writeFileSync(join(codex, "SKILL.md"), skill);

  writeFileSync(join(codex, "agents/openai.yaml"), ui.replace("$sample-skill", "$another-skill"));
  result = run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /default_prompt/);
  writeFileSync(join(codex, "agents/openai.yaml"), ui);

  rmSync(join(root, ".agents"), { recursive: true });
  result = run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /No skills directory.*\.agents/);
  console.log("Skill validator regression checks passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
