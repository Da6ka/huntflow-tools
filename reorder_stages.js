#!/usr/bin/env node

/**
 * Huntflow Pipeline Stage Manager (internal web API)
 *
 * The PUBLIC API (api.huntflow.ru/v2) is READ-ONLY for pipeline stages
 * (etapy podbora) — GET /vacancies/statuses works, but there is no
 * create/rename/reorder endpoint. huntflow.js uses that public API.
 *
 * This script talks to Huntflow's INTERNAL web API instead, which the
 * huntflow.ru web app itself uses to persist stage order:
 *
 *   GET  https://huntflow.ru/app/api/my/<org>/vacancy/status      -> current stages
 *   PUT  https://huntflow.ru/app/api/my/<org>/settings/statuses   -> save order
 *
 * The PUT body is a JSON array of { id, name } where ARRAY POSITION is the
 * display order. Virtual pseudo-stages (string ids) and the trash stage
 * ("Otkaz", type "trash") are excluded — this script filters them out for you.
 *
 * Auth is SESSION-BASED (not the Bearer token huntflow.js uses). You supply a
 * logged-in browser session cookie; the CSRF token is the `_xsrf` cookie value,
 * echoed back in the `x-xsrftoken` request header.
 *
 * Config (env):
 *   HUNTFLOW_WEB_ORG      Org nickname in the URL, e.g. "myorg"        (required)
 *   HUNTFLOW_WEB_COOKIE   Full Cookie header copied from a logged-in
 *                         huntflow.ru request (DevTools -> Network ->
 *                         any /app/api/ request -> Request Headers -> cookie) (required)
 *   HUNTFLOW_XSRF         Override CSRF token (defaults to the `_xsrf` value
 *                         parsed out of HUNTFLOW_WEB_COOKIE)              (optional)
 *
 * Cookies are short-lived — if you get 401/403, copy a fresh Cookie header.
 *
 * Usage:
 *   node reorder_stages.js list                          - stages in current order
 *   node reorder_stages.js move <id> before <targetId>   - move stage before another
 *   node reorder_stages.js move <id> after  <targetId>   - move stage after another
 *   node reorder_stages.js set-order <id,id,id,...>      - set explicit order (any
 *                                                          omitted stages keep their
 *                                                          relative order at the end)
 *
 * Flags:
 *   --json       Machine-readable JSON output
 *   --dry-run    Print the order that WOULD be saved; don't PUT
 */

const https = require('https');

const HOST = 'huntflow.ru';
const ORG = process.env.HUNTFLOW_WEB_ORG || '';
const COOKIE = process.env.HUNTFLOW_WEB_COOKIE || '';
const TIMEOUT_MS = parseInt(process.env.HUNTFLOW_TIMEOUT || '', 10) || 30000;

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

if (!ORG) {
  fail('ERROR: HUNTFLOW_WEB_ORG is not set (org nickname from the URL, e.g. "myorg").');
}
if (!COOKIE) {
  fail('ERROR: HUNTFLOW_WEB_COOKIE is not set.\n' +
       'Copy the Cookie header from a logged-in huntflow.ru request:\n' +
       '  DevTools -> Network -> any /app/api/ request -> Request Headers -> cookie');
}

function getXsrf() {
  if (process.env.HUNTFLOW_XSRF) return process.env.HUNTFLOW_XSRF;
  const m = COOKIE.match(/(?:^|;)\s*_xsrf=([^;]+)/);
  if (!m) fail('ERROR: could not find `_xsrf` in HUNTFLOW_WEB_COOKIE, and HUNTFLOW_XSRF is not set.');
  return decodeURIComponent(m[1]);
}

// --- HTTP ---

function request(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Accept': 'application/json',
      'Cookie': COOKIE,
    };
    if (body != null) {
      headers['Content-Type'] = 'application/json';
      headers['X-XSRFToken'] = getXsrf();
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const options = { hostname: HOST, path, method, headers, timeout: TIMEOUT_MS };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        let parsed;
        try { parsed = JSON.parse(data || 'null'); } catch { parsed = data; }
        if (ok) resolve(parsed);
        else reject({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${TIMEOUT_MS}ms: ${method} ${path}`)));
    if (body != null) req.write(body);
    req.end();
  });
}

const apiBase = `/app/api/my/${ORG}`;

// Fetch current stages, sorted by display order. Only real, editable stages
// (numeric id, not the trash "Otkaz") are kept — matching what the web app PUTs.
async function fetchStages() {
  const data = await request(`${apiBase}/vacancy/status`);
  const items = (data && data.items) || [];
  return items
    .filter((s) => typeof s.id === 'number' && s.type !== 'trash')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

async function saveOrder(stages) {
  const body = JSON.stringify(stages.map((s) => ({ id: s.id, name: s.name })));
  return request(`${apiBase}/settings/statuses`, 'PUT', body);
}

// --- Reorder helpers ---

function moveBeforeAfter(stages, stageId, where, targetId) {
  const idx = stages.findIndex((s) => s.id === stageId);
  if (idx < 0) throw new Error(`Stage id ${stageId} not found`);
  const [moved] = stages.splice(idx, 1);
  const targetIdx = stages.findIndex((s) => s.id === targetId);
  if (targetIdx < 0) throw new Error(`Target id ${targetId} not found`);
  const insertAt = where === 'after' ? targetIdx + 1 : targetIdx;
  stages.splice(insertAt, 0, moved);
  return stages;
}

function applyExplicitOrder(stages, orderedIds) {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const seen = new Set();
  const result = [];
  for (const id of orderedIds) {
    const s = byId.get(id);
    if (!s) throw new Error(`Stage id ${id} not found`);
    if (seen.has(id)) throw new Error(`Duplicate id ${id} in order`);
    seen.add(id);
    result.push(s);
  }
  // Any stages not named keep their existing relative order, appended at the end.
  for (const s of stages) if (!seen.has(s.id)) result.push(s);
  return result;
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const dryRun = args.includes('--dry-run');
  const KNOWN_FLAGS = new Set(['--json', '--dry-run']);
  const a = args.filter((x) => !KNOWN_FLAGS.has(x));
  const command = a[0];

  try {
    if (command === 'list' || !command) {
      const stages = await fetchStages();
      if (jsonMode) { console.log(JSON.stringify(stages, null, 2)); return; }
      stages.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. [${s.id}] ${s.name}`));
      return;
    }

    if (command === 'move') {
      const stageId = parseInt(a[1], 10);
      const where = a[2];
      const targetId = parseInt(a[3], 10);
      if (!Number.isInteger(stageId) || !['before', 'after'].includes(where) || !Number.isInteger(targetId)) {
        fail('Usage: move <stageId> before|after <targetId>');
      }
      const stages = await fetchStages();
      const reordered = moveBeforeAfter(stages, stageId, where, targetId);
      if (dryRun) {
        if (jsonMode) console.log(JSON.stringify(reordered.map((s) => ({ id: s.id, name: s.name })), null, 2));
        else reordered.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. [${s.id}] ${s.name}`));
        return;
      }
      const res = await saveOrder(reordered);
      if (jsonMode) console.log(JSON.stringify(res, null, 2));
      else console.log(`Saved. New order:\n` + reordered.map((s, i) => `${String(i + 1).padStart(2)}. [${s.id}] ${s.name}`).join('\n'));
      return;
    }

    if (command === 'set-order') {
      const ids = (a[1] || '').split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isInteger(n));
      if (!ids.length) fail('Usage: set-order <id,id,id,...>');
      const stages = await fetchStages();
      const reordered = applyExplicitOrder(stages, ids);
      if (dryRun) {
        if (jsonMode) console.log(JSON.stringify(reordered.map((s) => ({ id: s.id, name: s.name })), null, 2));
        else reordered.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. [${s.id}] ${s.name}`));
        return;
      }
      const res = await saveOrder(reordered);
      if (jsonMode) console.log(JSON.stringify(res, null, 2));
      else console.log(`Saved. New order:\n` + reordered.map((s, i) => `${String(i + 1).padStart(2)}. [${s.id}] ${s.name}`).join('\n'));
      return;
    }

    console.log(`Huntflow Pipeline Stage Manager (internal web API)

Set HUNTFLOW_WEB_ORG and HUNTFLOW_WEB_COOKIE, then:

  list                              Stages in current display order
  move <id> before|after <target>   Move a stage relative to another
  set-order <id,id,id,...>          Explicit order (omitted stages kept at end)

Flags:
  --json      Machine-readable JSON output
  --dry-run   Show the order that would be saved; don't write`);
  } catch (err) {
    if (err && err.status) {
      const hint = (err.status === 401 || err.status === 403)
        ? ' (session cookie is likely stale — copy a fresh Cookie header from the browser)'
        : '';
      console.error(`Error ${err.status}${hint}:`, JSON.stringify(err.body, null, 2));
    } else {
      console.error('Error:', (err && err.message) || err);
    }
    process.exit(1);
  }
}

main();
