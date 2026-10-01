/**
 * Offline tests for add_resume.js: multipart filename escaping and the
 * warning when a refreshed token cannot be saved. No network, no real tokens:
 * HOME points at a temp dir, so TOKEN_FILE never touches ~/.huntflow.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-test-'));
process.env.HOME = home;
const { safeFilename, writeTokenFile, orphanNote } = require('./add_resume.js');

test('safeFilename: quotes and line breaks cannot leave the header', () => {
  assert.strictEqual(safeFilename('a"b\r\nc.pdf'), 'a_b__c.pdf');
  assert.strictEqual(safeFilename('cv.pdf'), 'cv.pdf');
});

test('writeTokenFile: saves with mode 0600', () => {
  writeTokenFile({ access_token: 'x', refresh_token: 'y' });
  const f = path.join(home, '.huntflow', 'tokens.json');
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
});

test('writeTokenFile: warns instead of failing silently', () => {
  // A file where the directory should be makes mkdir fail.
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-test-'));
  fs.writeFileSync(path.join(bad, '.huntflow'), '');
  const out = require('child_process').spawnSync(
    process.execPath,
    ['-e', "require('./add_resume.js').writeTokenFile({})"],
    { env: { ...process.env, HOME: bad }, cwd: __dirname, encoding: 'utf8' }
  );
  assert.match(out.stderr, /WARNING: could not save refreshed tokens/);
});

test('orphanNote: names both ids and says the temp is not merged', () => {
  const note = orphanNote(111, 222);
  assert.match(note, /temp applicant 111 was created but NOT merged into 222/);
  assert.match(note, /cannot delete/);
});
