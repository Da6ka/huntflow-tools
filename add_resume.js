#!/usr/bin/env node

/**
 * Huntflow: add a resume (CV) to an EXISTING applicant — deterministically.
 *
 * The PUBLIC v2 API cannot attach a resume to an applicant that already exists
 * (POST /applicants/<id>/externals -> 404; externals are create-time only), and
 * Huntflow support confirmed the only supported path is "create a new applicant
 * with the CV, then merge". This script does exactly that, addressing the merge
 * by EXPLICIT ids so it never relies on Huntflow's fuzzy async auto-dedup:
 *
 *   1. upload + parse the CV            POST /v2/accounts/<a>/upload  (X-File-Parse)
 *   2. create a temp applicant with it  POST /v2/accounts/<a>/applicants
 *   3. merge temp INTO the target       POST /app/api/my/<org>/applicant/merge/<keep>/<remove>
 *
 * The merge keeps <keep_id> (your target) and folds <remove_id> (the temp record
 * carrying the fresh resume) into it, then removes the temp. Both ids keep
 * resolving afterwards (the removed id aliases to the survivor).
 *
 * TWO auth systems, on purpose:
 *   - upload + create (public API): Bearer token, same source as huntflow.js
 *     (Keychain huntflow-access-token, or ~/.huntflow/tokens.json).
 *   - merge (web API):              session cookie, same as reorder_stages.js
 *     (HUNTFLOW_WEB_COOKIE + x-xsrftoken from the _xsrf cookie).
 *
 * Config (env):
 *   HUNTFLOW_ACCOUNT_ID   numeric account id, e.g. 123456                    [required]
 *   HUNTFLOW_WEB_ORG      org nickname in the URL, e.g. "myorg"           [required]
 *   HUNTFLOW_WEB_COOKIE   full Cookie header from a logged-in huntflow.ru request  [required]
 *                         (DevTools -> Network -> any /app/api/ request -> Copy as cURL,
 *                          the -b '...' value). Cookies are short-lived — refresh on 401/403.
 *   HUNTFLOW_XSRF         override CSRF token (defaults to _xsrf from the cookie)  [optional]
 *
 * Usage:
 *   node add_resume.js <applicant_id> <cv.pdf> [--source <id>] [--auth-type NATIVE] [--json] [--dry-run]
 *
 * Flags:
 *   --source <id>       account_source for the resume (default: $HUNTFLOW_DEFAULT_SOURCE_ID)
 *   --auth-type <type>  external auth_type (default NATIVE)
 *   --json              machine-readable JSON output
 *   --dry-run           print the plan; upload nothing, create nothing, merge nothing
 *   --keep-temp         do NOT merge — just create the temp record and print its id
 *                       (escape hatch for when you want to merge manually in the UI)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Source ids are per-account. Set HUNTFLOW_DEFAULT_SOURCE_ID or pass --source.
const DEFAULT_SOURCE = parseInt(process.env.HUNTFLOW_DEFAULT_SOURCE_ID || '', 10) || null;
const TIMEOUT_MS = parseInt(process.env.HUNTFLOW_TIMEOUT || '', 10) || 30000;
const TOKEN_FILE = path.join(os.homedir(), '.huntflow', 'tokens.json');

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

// --- Bearer token (public API), mirrors huntflow.js ---

function getFromKeychain(service) {
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-a', 'huntflow', '-w'], {
      encoding: 'utf-8',
    }).trim();
  } catch {
    return null;
  }
}
function saveToKeychain(service, value) {
  try {
    execFileSync('security', ['add-generic-password', '-s', service, '-a', 'huntflow', '-w', value, '-U']);
    return true;
  } catch {
    return false;
  }
}
function readTokenFile() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
  } catch {
    return null;
  }
}
// A quote or CR/LF in the name would break out of the multipart header.
function safeFilename(name) {
  return name.replace(/["\r\n]/g, '_');
}

function writeTokenFile(tokens) {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    const tmp = `${TOKEN_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, TOKEN_FILE);
  } catch (e) {
    // A refreshed token that is not saved means the next call fails with 401.
    console.error(`WARNING: could not save refreshed tokens to ${TOKEN_FILE}: ${e.message}`);
  }
}
function getAccessToken() {
  return getFromKeychain('huntflow-access-token') || (readTokenFile() || {}).access_token || null;
}
function getRefreshToken() {
  return getFromKeychain('huntflow-refresh-token') || (readTokenFile() || {}).refresh_token || null;
}

// --- generic HTTPS ---

function httpRequest(hostname, reqPath, method, headers, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, path: reqPath, method, headers, timeout: TIMEOUT_MS };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        let parsed;
        try {
          parsed = JSON.parse(raw || 'null');
        } catch {
          parsed = raw;
        }
        if (ok) resolve(parsed);
        else reject({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${TIMEOUT_MS}ms: ${method} ${reqPath}`)));
    if (body != null) req.write(body);
    req.end();
  });
}

// --- public API (Bearer) with one auto-refresh on 401 ---

async function refreshTokens() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('No refresh token (set Keychain or ~/.huntflow/tokens.json)');
  const data = await httpRequest(
    'api.huntflow.ru',
    '/v2/token/refresh',
    'POST',
    { 'Content-Type': 'application/json', Accept: 'application/json' },
    JSON.stringify({ refresh_token: refreshToken })
  );
  const okA = saveToKeychain('huntflow-access-token', data.access_token);
  const okR = saveToKeychain('huntflow-refresh-token', data.refresh_token);
  if (!okA || !okR) writeTokenFile({ access_token: data.access_token, refresh_token: data.refresh_token });
  return data.access_token;
}

async function publicApi(reqPath, { method = 'GET', body = null, contentType = 'application/json', extraHeaders = {} } = {}) {
  const send = (token) => {
    const headers = { Accept: 'application/json', Authorization: `Bearer ${token}`, ...extraHeaders };
    if (body != null) {
      headers['Content-Type'] = contentType;
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    return httpRequest('api.huntflow.ru', `/v2${reqPath}`, method, headers, body);
  };
  let token = getAccessToken();
  if (!token) throw new Error('No access token (set Keychain or ~/.huntflow/tokens.json)');
  try {
    return await send(token);
  } catch (e) {
    if (e && e.status === 401) return send(await refreshTokens());
    throw e;
  }
}

async function uploadCv(accountId, cvPath) {
  const cvBytes = fs.readFileSync(cvPath);
  const boundary = '----' + crypto.randomBytes(16).toString('hex');
  const filename = path.basename(cvPath);
  const ext = path.extname(cvPath).toLowerCase();
  const ctype =
    ext === '.pdf'
      ? 'application/pdf'
      : ext === '.doc'
      ? 'application/msword'
      : ext === '.docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/octet-stream';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename(filename)}"\r\n` +
      `Content-Type: ${ctype}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, cvBytes, tail]);
  return publicApi(`/accounts/${accountId}/upload`, {
    method: 'POST',
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    extraHeaders: { 'X-File-Parse': 'true' },
  });
}

// --- web API (session cookie), mirrors reorder_stages.js ---

function webAuth() {
  const org = process.env.HUNTFLOW_WEB_ORG || '';
  const cookie = process.env.HUNTFLOW_WEB_COOKIE || '';
  if (!org) fail('ERROR: HUNTFLOW_WEB_ORG is not set (org nickname from the URL, e.g. "myorg").');
  if (!cookie) {
    fail(
      'ERROR: HUNTFLOW_WEB_COOKIE is not set.\n' +
        'Copy the Cookie header from a logged-in huntflow.ru request:\n' +
        '  DevTools -> Network -> any /app/api/ request -> Copy as cURL -> the -b \'...\' value'
    );
  }
  let xsrf = process.env.HUNTFLOW_XSRF;
  if (!xsrf) {
    const m = cookie.match(/(?:^|;)\s*_xsrf=([^;]+)/);
    if (!m) fail('ERROR: could not find `_xsrf` in HUNTFLOW_WEB_COOKIE, and HUNTFLOW_XSRF is not set.');
    xsrf = decodeURIComponent(m[1]);
  }
  return { org, cookie, xsrf };
}

// Merge <removeId> INTO <keepId>. Ids are in the path; the request carries no body,
// only the session cookie + CSRF token.
function mergeOnce(keepId, removeId, auth) {
  const headers = {
    Accept: 'application/json',
    Cookie: auth.cookie,
    Origin: 'https://huntflow.ru',
    'X-XSRFToken': auth.xsrf,
    'Content-Length': 0,
  };
  return httpRequest('huntflow.ru', `/app/api/my/${auth.org}/applicant/merge/${keepId}/${removeId}`, 'POST', headers, null);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The merge endpoint only fires once Huntflow has registered the two records as
// duplicates ("doubles"), and that detection is ASYNC — right after creating the
// temp it can still 400 with "Unknown double". Retry a few times to let detection
// catch up. (A real target has a unique identity, so its temp is detected quickly;
// only pathological identical-twin targets stay unresolved.)
async function mergeApplicants(keepId, removeId, auth, { retries = 6, delayMs = 1500 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await mergeOnce(keepId, removeId, auth);
    } catch (e) {
      const isUnknownDouble =
        e && e.status === 400 && JSON.stringify(e.body || '').toLowerCase().includes('unknown double');
      if (!isUnknownDouble) throw e;
      lastErr = e;
      if (i < retries) await sleep(delayMs);
    }
  }
  throw lastErr;
}

// Read-only call that needs the session cookie. A stale cookie is the usual reason a
// merge fails, so check it BEFORE creating the temp applicant (the public API cannot
// delete one, so a failed merge leaves an orphan record behind).
function checkWebSession(auth) {
  const headers = { Accept: 'application/json', Cookie: auth.cookie };
  return httpRequest('huntflow.ru', `/app/api/my/${auth.org}/vacancy/status`, 'GET', headers, null);
}

function orphanNote(tempId, targetId) {
  return (
    `WARNING: temp applicant ${tempId} was created but NOT merged into ${targetId}. ` +
    `The API cannot delete applicants: merge ${tempId} into ${targetId} in the Huntflow UI, or delete it there. ` +
    `Do not re-run before that, or a second temp record is created.`
  );
}

// --- main ---

function parseArgs(argv) {
  const flags = { source: DEFAULT_SOURCE, authType: 'NATIVE', json: false, dryRun: false, keepTemp: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') flags.json = true;
    else if (t === '--dry-run') flags.dryRun = true;
    else if (t === '--keep-temp') flags.keepTemp = true;
    else if (t === '--source') flags.source = parseInt(argv[++i], 10);
    else if (t === '--auth-type') flags.authType = argv[++i];
    else pos.push(t);
  }
  return { flags, pos };
}

async function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  const targetId = parseInt(pos[0], 10);
  const cvPath = pos[1];

  if (!Number.isInteger(targetId) || !cvPath) {
    fail('Usage: node add_resume.js <applicant_id> <cv.pdf> [--source <id>] [--auth-type NATIVE] [--json] [--dry-run] [--keep-temp]');
  }
  if (!Number.isInteger(flags.source)) fail('ERROR: set --source <id> or HUNTFLOW_DEFAULT_SOURCE_ID (a numeric account_source id).');

  const auth = webAuth(); // validate web env up front (fail fast before any write)
  const accountId = parseInt(process.env.HUNTFLOW_ACCOUNT_ID || '', 10);
  if (!accountId) fail('ERROR: HUNTFLOW_ACCOUNT_ID is not set.');

  try {
    // 1. Read the target so the temp record carries the same identity (and so we
    //    fail early if the target id is wrong).
    const target = await publicApi(`/accounts/${accountId}/applicants/${targetId}`);
    const identity = {
      last_name: target.last_name || '',
      first_name: target.first_name || '',
      middle_name: target.middle_name || '',
      phone: target.phone || '',
      email: target.email || '',
    };
    if (!identity.last_name && !identity.first_name) {
      fail(`ERROR: target applicant ${targetId} has no name — refusing (wrong id?).`);
    }

    if (flags.dryRun) {
      const line = `DRY RUN — would: upload ${path.basename(cvPath)} -> create temp applicant "${`${identity.first_name} ${identity.last_name}`.trim()}" with the resume (source ${flags.source}) -> POST /app/api/my/${auth.org}/applicant/merge/${targetId}/<temp_id>`;
      console.log(flags.json ? JSON.stringify({ targetId, cv: cvPath, source: flags.source }, null, 2) : line);
      return;
    }

    // 2. Upload + parse the CV. Validate the session cookie first, nothing is written yet.
    if (!fs.existsSync(cvPath)) fail(`ERROR: CV file not found: ${cvPath}`);
    if (!flags.keepTemp) await checkWebSession(auth);
    const up = await uploadCv(accountId, cvPath);
    const fileId = up.id;
    if (!fileId) fail(`ERROR: upload returned no file id: ${JSON.stringify(up)}`);

    // 3. Create a temp applicant carrying the fresh resume.
    const createBody = JSON.stringify({
      ...identity,
      externals: [{ auth_type: flags.authType, account_source: flags.source, files: [fileId], data: { body: up.text || '' } }],
    });
    const temp = await publicApi(`/accounts/${accountId}/applicants`, { method: 'POST', body: createBody });
    const tempId = temp.id;
    if (!tempId) fail(`ERROR: temp applicant create returned no id: ${JSON.stringify(temp)}`);

    if (flags.keepTemp) {
      const msg = `Created temp applicant ${tempId} with the resume. NOT merged (--keep-temp). Merge it into ${targetId} manually, or re-run without --keep-temp.`;
      console.log(flags.json ? JSON.stringify({ tempId, targetId, fileId, merged: false }, null, 2) : msg);
      return;
    }

    // 4. Merge temp INTO the target (keep target, remove temp).
    try {
      await mergeApplicants(targetId, tempId, auth);
    } catch (e) {
      console.error(orphanNote(tempId, targetId));
      throw e;
    }

    // 5. Verify the resume now lives on the target. Two gotchas: the merge
    //    reassigns the canonical id (the old id becomes an alias whose external
    //    list reads back empty — follow the canonical id first), and the applicant
    //    *summary* always reports external[].files as [] — so confirm the file
    //    through each external's *detail* endpoint.
    let verified = null;
    try {
      let applicant = await publicApi(`/accounts/${accountId}/applicants/${targetId}`);
      const canonicalId = applicant.id;
      if (canonicalId && canonicalId !== targetId) {
        applicant = await publicApi(`/accounts/${accountId}/applicants/${canonicalId}`);
      }
      let externalId = null;
      for (const e of applicant.external || []) {
        const detail = await publicApi(`/accounts/${accountId}/applicants/${canonicalId}/externals/${e.id}`);
        if ((detail.files || []).some((f) => f.id === fileId)) {
          externalId = e.id;
          break;
        }
      }
      verified = { canonicalId, externalId, attached: !!externalId };
    } catch {
      /* best-effort */
    }

    if (flags.json) {
      console.log(JSON.stringify({ targetId, tempId, fileId, merged: true, verified }, null, 2));
    } else {
      const name = `${identity.first_name} ${identity.last_name}`.trim();
      if (verified && verified.attached) {
        console.log(`OK — resume (file ${fileId}) added to ${name} [${targetId}] via create+merge.`);
        console.log(`   temp record ${tempId} merged in | canonical id now ${verified.canonicalId} | resume external ${verified.externalId}`);
      } else {
        console.log(`Merged temp ${tempId} into ${targetId}, but could not confirm the file on the card — verify manually.`);
        console.log(`   ${JSON.stringify(verified)}`);
      }
    }
  } catch (err) {
    if (err && err.status) {
      const hint =
        err.status === 401 || err.status === 403
          ? ' (session cookie is likely stale — copy a fresh Cookie header from the browser)'
          : '';
      console.error(`Error ${err.status}${hint}:`, JSON.stringify(err.body, null, 2));
    } else {
      console.error('Error:', (err && err.message) || err);
    }
    process.exit(1);
  }
}

if (require.main === module) main();
// Exported for test_add_resume.js.
module.exports = { safeFilename, writeTokenFile, orphanNote };
