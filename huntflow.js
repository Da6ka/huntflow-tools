#!/usr/bin/env node

/**
 * Huntflow ATS Helper
 *
 * Reads ACCOUNT_ID from env (HUNTFLOW_ACCOUNT_ID) and tokens from:
 *   1. macOS Keychain (service: huntflow-access-token / huntflow-refresh-token, account: huntflow), or
 *   2. ~/.huntflow/tokens.json — { "access_token": "...", "refresh_token": "..." }
 *
 * Usage:
 *   node huntflow.js me                              - current user
 *   node huntflow.js vacancies [--open] [--mine]     - list vacancies (--open = only OPEN, --mine = yours)
 *   node huntflow.js vacancy <id>                    - vacancy details
 *   node huntflow.js pipeline <vacancy_id> [sid]     - candidates in vacancy pipeline (optional stage filter)
 *   node huntflow.js applicant <id>                  - applicant details
 *   node huntflow.js resume <applicant_id>           - applicant resume(s)
 *   node huntflow.js logs <applicant_id>             - applicant pipeline history
 *   node huntflow.js comments <applicant_id>         - comments on an applicant
 *   node huntflow.js comment <aid> <text> [--vacancy <vid>]  - add a comment
 *   node huntflow.js statuses                        - pipeline stages
 *   node huntflow.js rejections                      - rejection reasons
 *   node huntflow.js move <aid> <vid> <sid> [rid] [--comment <t>|--comment-file <p>]  - move applicant to stage
 *   node huntflow.js create-vacancy <position> --deadline <YYYY-MM-DD> [opts]  - create a vacancy
 *   node huntflow.js close <vid> [reason_id]         - close a vacancy (optional close reason)
 *   node huntflow.js close-reasons                   - list vacancy close reasons
 *   node huntflow.js search <query> [--vacancy <id>] [--status <id>] [--tag <id>]  - search applicants
 *   node huntflow.js coworkers                       - recruiters and other account members
 *   node huntflow.js divisions                       - divisions
 *   node huntflow.js tags                            - tags
 *   node huntflow.js sources                         - resume sources
 *   node huntflow.js add <first> <last> --vacancy <vid> [opts]  - create applicant + attach to vacancy
 *
 * `add` options: --status <sid> (default: first pipeline stage), --position <text>,
 *   --linkedin <url>, --github <url>, --location <text>, --email <addr>,
 *   --email2 <addr> (secondary, into the "2nd Email" field), --source <src_id>
 *   (default: LinkedIn), --tag <tag_id> (default: $HUNTFLOW_DEFAULT_TAG_ID, else none), --no-tag.
 *
 * `create-vacancy` options: --deadline <YYYY-MM-DD> (required — the API rejects a
 *   vacancy without a hiring plan), --hire <n> (default: 1), --division <id>,
 *   --money <text>, --company <text>, --priority <0|1>, --state <OPEN|HOLD>
 *   (default: OPEN), --hidden, --dry-run (print the request body, don't POST).
 *
 * Flags:
 *   --json     Machine-readable JSON output
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const API_BASE = 'https://api.huntflow.ru/v2';
const ACCOUNT_ID = parseInt(process.env.HUNTFLOW_ACCOUNT_ID || '', 10);
const TIMEOUT_MS = parseInt(process.env.HUNTFLOW_TIMEOUT || '', 10) || 30000;

// `--help` and a bare invocation only print usage, which is exactly what
// someone who hasn't set the account ID yet needs to read.
const HELP_ONLY = process.argv.length <= 2 || ['-h', '--help'].includes(process.argv[2]);

// Only enforce the account-id requirement for the CLI. When required as a
// module (offline unit tests), the pure helpers don't touch ACCOUNT_ID, so a
// missing env var must not exit the process.
if (!ACCOUNT_ID && require.main === module && !HELP_ONLY) {
  console.error('ERROR: HUNTFLOW_ACCOUNT_ID env var is not set.');
  console.error('Find it via: GET https://api.huntflow.ru/v2/accounts (Authorization: Bearer <access_token>).');
  process.exit(1);
}

const TOKEN_FILE = path.join(os.homedir(), '.huntflow', 'tokens.json');

// --- Token Management ---

function getFromKeychain(service) {
  if (process.platform !== 'darwin') return null;
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-a', 'huntflow', '-w'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch {
    return null;
  }
}

function saveToKeychain(service, value) {
  if (process.platform !== 'darwin') return false;
  try {
    execFileSync(
      'security',
      ['add-generic-password', '-s', service, '-a', 'huntflow', '-w', value, '-U'],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
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

function writeTokenFile(tokens) {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    // Write to a temp file then rename, so a crash mid-write can't leave a
    // truncated/corrupt tokens.json and lock us out.
    const tmp = `${TOKEN_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, TOKEN_FILE);
    return true;
  } catch {
    return false;
  }
}

function getAccessToken() {
  return getFromKeychain('huntflow-access-token')
      || (readTokenFile() || {}).access_token
      || null;
}

function getRefreshToken() {
  return getFromKeychain('huntflow-refresh-token')
      || (readTokenFile() || {}).refresh_token
      || null;
}

async function refreshTokens() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('No refresh token (set keychain or ~/.huntflow/tokens.json)');

  const body = JSON.stringify({ refresh_token: refreshToken });
  const data = await rawRequest('/token/refresh', 'POST', body, false);

  const savedAccess = saveToKeychain('huntflow-access-token', data.access_token);
  const savedRefresh = saveToKeychain('huntflow-refresh-token', data.refresh_token);
  if (!savedAccess || !savedRefresh) {
    writeTokenFile({ access_token: data.access_token, refresh_token: data.refresh_token });
  }

  return data.access_token;
}

// --- HTTP ---

function rawRequest(path, method = 'GET', body = null, useAuth = true, tokenOverride = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${path}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      timeout: TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    };

    if (useAuth) {
      const token = tokenOverride || getAccessToken();
      if (!token) return reject(new Error('No access token (set keychain or ~/.huntflow/tokens.json)'));
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        let parsed;
        try {
          parsed = JSON.parse(data || 'null');
        } catch {
          if (ok) { reject(new Error(`HTTP ${res.statusCode}: invalid JSON: ${data}`)); return; }
          reject({ status: res.statusCode, body: data });
          return;
        }
        if (ok) resolve(parsed);
        else reject({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${TIMEOUT_MS}ms: ${method} ${path}`)));
    if (body) req.write(body);
    req.end();
  });
}

async function api(path, method = 'GET', body = null) {
  try {
    return await rawRequest(path, method, body);
  } catch (err) {
    // Auto-refresh only on 401. Huntflow returns 401 for a recognized-but-expired
    // token (the normal refresh trigger). A malformed/corrupt token is unknown to
    // the server and comes back as 404 instead — that does NOT self-heal here, it
    // just surfaces the error. Atomic token writes (writeTokenFile) are what keep a
    // partial write from ever leaving such a corrupt token behind.
    if (err && err.status === 401) {
      const newToken = await refreshTokens();
      // Use the freshly issued token directly; re-reading storage can return a
      // stale Keychain value if the write fell back to the token file.
      return await rawRequest(path, method, body, true, newToken);
    }
    throw err;
  }
}

// Ids from the command line go into URL paths: digits only.
function num(v) {
  if (!/^\d+$/.test(String(v))) throw new Error(`Invalid id: ${v}`);
  return v;
}

function acct(path) {
  return `/accounts/${ACCOUNT_ID}${path}`;
}

// --- Commands ---

async function cmdMe() { return api('/me'); }

async function cmdVacancies(onlyOpen = false, mine = false) {
  const allItems = [];
  let page = 1;
  while (true) {
    const data = await api(acct(`/vacancies?page=${page}&count=100${mine ? '&mine=true' : ''}`));
    if (!Array.isArray(data.items)) break;
    allItems.push(...data.items);
    if (!data.total_pages || page >= data.total_pages) break;
    page++;
  }
  return onlyOpen ? allItems.filter(v => v.state === 'OPEN') : allItems;
}

async function cmdVacancy(id) { return api(acct(`/vacancies/${num(id)}`)); }

async function cmdPipeline(vacancyId, statusId = null) {
  const allItems = [];
  let page = 1;
  while (true) {
    // The /applicants endpoint caps count at 30 (unlike /vacancies, which allows 100).
    let url = acct(`/applicants?vacancy=${num(vacancyId)}&page=${page}&count=30`);
    if (statusId) url += `&status=${num(statusId)}`;
    const data = await api(url);
    if (!Array.isArray(data.items)) break;
    allItems.push(...data.items);
    if (!data.total_pages || page >= data.total_pages) break;
    page++;
  }
  return allItems;
}

async function cmdApplicant(id) { return api(acct(`/applicants/${num(id)}`)); }

async function cmdResume(applicantId) {
  const applicant = await api(acct(`/applicants/${num(applicantId)}`));
  if (!applicant.external || !applicant.external.length) return { items: [] };
  const items = [];
  for (const ext of applicant.external) {
    try {
      const resume = await api(acct(`/applicants/${num(applicantId)}/externals/${ext.id}`));
      items.push(resume);
    } catch (err) {
      // A missing external is fine to skip; anything else (auth/network) should surface.
      if (err && err.status === 404) continue;
      throw err;
    }
  }
  return { items };
}

async function cmdLogs(applicantId) { return api(acct(`/applicants/${num(applicantId)}/logs`)); }
async function cmdComments(applicantId) { return api(acct(`/applicants/${num(applicantId)}/logs?type=COMMENT`)); }

// Comments are journal entries (POST .../logs). Without `vacancy` it is a personal
// note; the API has no edit or delete, so a wrong comment stays.
async function cmdComment(applicantId, text, vacancyId = null) {
  const body = { comment: text };
  if (vacancyId != null) {
    const vacancy = parseInt(vacancyId, 10);
    if (!Number.isInteger(vacancy)) throw new Error(`Invalid vacancy id: ${vacancyId}`);
    body.vacancy = vacancy;
  }
  return api(acct(`/applicants/${num(applicantId)}/logs`), 'POST', JSON.stringify(body));
}

function parseCommentOpts(tokens) {
  const opts = {};
  const words = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--vacancy') {
      opts.vacancy = tokens[++i];
      if (opts.vacancy === undefined) throw new Error('Missing value for --vacancy');
    } else words.push(tokens[i]);
  }
  opts.applicant = words[0];
  opts.text = words.slice(1).join(' ');
  if (!opts.applicant || !opts.text) throw new Error('Usage: comment <applicant_id> <text> [--vacancy <vid>]');
  return opts;
}
async function cmdStatuses() { return api(acct('/vacancies/statuses')); }
async function cmdRejections() { return api(acct('/rejection_reasons')); }

async function cmdMove(applicantId, vacancyId, statusId, rejectionId = null, comment = null) {
  const vacancy = parseInt(vacancyId, 10);
  const status = parseInt(statusId, 10);
  if (!Number.isInteger(vacancy)) throw new Error(`Invalid vacancy id: ${vacancyId}`);
  if (!Number.isInteger(status)) throw new Error(`Invalid status id: ${statusId}`);
  const body = { vacancy, status };
  if (rejectionId) {
    const rejection = parseInt(rejectionId, 10);
    if (!Number.isInteger(rejection)) throw new Error(`Invalid rejection id: ${rejectionId}`);
    body.rejection_reason = rejection;
  }
  if (comment != null && comment !== '') body.comment = comment;
  // Huntflow is method-sensitive on this endpoint: POST attaches an applicant to a
  // vacancy for the first time, PUT changes the status of one already linked. Calling
  // the wrong method fails (PUT on an unlinked applicant returns 400; POST on a linked
  // one returns "already added"). Look up the applicant's existing links and choose the
  // method deterministically, rather than guessing from an error status.
  const applicant = await api(acct(`/applicants/${num(applicantId)}`));
  const linked = Array.isArray(applicant.links)
    && applicant.links.some(l => l && l.vacancy === vacancy);
  const method = linked ? 'PUT' : 'POST';
  return api(acct(`/applicants/${num(applicantId)}/vacancy`), method, JSON.stringify(body));
}

async function cmdClose(vacancyId, reasonId = null) {
  const vacancy = Number(num(vacancyId));
  const body = { state: 'CLOSED' };
  if (reasonId != null && reasonId !== '') {
    const reason = parseInt(reasonId, 10);
    if (!Number.isInteger(reason)) throw new Error(`Invalid close reason id: ${reasonId}`);
    body.close_reason = reason;
  }
  // Partial update: only `state` (and optional close_reason) are sent, other
  // fields are left untouched. Close reason is optional in this account.
  return api(acct(`/vacancies/${vacancy}`), 'PATCH', JSON.stringify(body));
}

// Update a vacancy's editable fields via PATCH. Partial: only the fields passed
// are sent, everything else is left untouched. body/requirements/conditions are
// the HTML description blocks (responsibilities / requirements / conditions in the UI).
async function cmdUpdateVacancy(opts) {
  const vacancy = Number(num(opts.vacancy));

  const body = {};
  if (opts.body != null) body.body = opts.body;
  if (opts.requirements != null) body.requirements = opts.requirements;
  if (opts.conditions != null) body.conditions = opts.conditions;
  if (opts.money != null) body.money = opts.money;
  if (opts.position != null) body.position = opts.position;
  if (opts.state != null) {
    const state = opts.state.toUpperCase();
    if (!['OPEN', 'HOLD', 'CLOSED'].includes(state)) throw new Error(`Invalid --state (expected OPEN, HOLD or CLOSED): ${opts.state}`);
    body.state = state;
  }

  if (Object.keys(body).length === 0) {
    throw new Error('update-vacancy needs at least one field: --body / --requirements / --conditions (or their --*-file forms), --money, --position, --state');
  }

  if (opts.dryRun) return { dryRun: true, vacancy, body };
  return api(acct(`/vacancies/${vacancy}`), 'PATCH', JSON.stringify(body));
}

// Create a vacancy. The API rejects the request without `fill_quotas` (the
// hiring plan), so --deadline is required rather than silently invented here.
async function cmdCreateVacancy(opts) {
  const position = opts.position;
  if (!position) throw new Error('create-vacancy requires <position>');
  if (!opts.deadline) throw new Error('create-vacancy requires --deadline <YYYY-MM-DD> (API requires a hiring plan)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.deadline)) throw new Error(`Invalid --deadline (expected YYYY-MM-DD): ${opts.deadline}`);

  const hire = opts.hire != null ? parseInt(opts.hire, 10) : 1;
  if (!Number.isInteger(hire) || hire < 1) throw new Error(`Invalid --hire: ${opts.hire}`);

  const state = (opts.state || 'OPEN').toUpperCase();
  if (!['OPEN', 'HOLD'].includes(state)) throw new Error(`Invalid --state (expected OPEN or HOLD): ${opts.state}`);

  const body = {
    position,
    state,
    priority: opts.priority != null ? parseInt(opts.priority, 10) : 0,
    hidden: !!opts.hidden,
    fill_quotas: [{ deadline: opts.deadline, applicants_to_hire: hire }],
  };
  if (!Number.isInteger(body.priority)) throw new Error(`Invalid --priority: ${opts.priority}`);

  if (opts.division != null) {
    const division = parseInt(opts.division, 10);
    if (!Number.isInteger(division)) throw new Error(`Invalid --division: ${opts.division}`);
    body.account_division = division;
  }
  if (opts.money) body.money = opts.money;
  if (opts.company) body.company = opts.company;

  if (opts.dryRun) return { dryRun: true, body };
  return api(acct('/vacancies'), 'POST', JSON.stringify(body));
}

// Parse `create-vacancy` args: one positional (<position>) plus --flag value
// pairs and the boolean --hidden.
function parseCreateVacancyOpts(tokens) {
  const VALUE_FLAGS = {
    '--division': 'division', '--deadline': 'deadline', '--hire': 'hire',
    '--money': 'money', '--company': 'company', '--priority': 'priority',
    '--state': 'state',
  };
  const opts = {};
  const positionals = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--hidden') { opts.hidden = true; continue; }
    if (t === '--dry-run') { opts.dryRun = true; continue; }
    if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, t)) {
      const val = tokens[++i];
      if (val === undefined) throw new Error(`Missing value for ${t}`);
      opts[VALUE_FLAGS[t]] = val;
      continue;
    }
    if (t.startsWith('--')) throw new Error(`Unknown flag: ${t}`);
    positionals.push(t);
  }
  if (positionals.length > 1) throw new Error(`Unexpected extra argument: ${positionals[1]} (quote the position if it has spaces)`);
  opts.position = positionals[0];
  return opts;
}

// Parse `update-vacancy` args: one positional (<vacancy_id>) plus --flag value
// pairs. The --*-file variants read the field's HTML from a file, which is the
// practical way to pass long description blocks without shell-quoting hell.
function parseUpdateVacancyOpts(tokens) {
  const VALUE_FLAGS = {
    '--body': 'body', '--requirements': 'requirements', '--conditions': 'conditions',
    '--money': 'money', '--position': 'position', '--state': 'state',
  };
  const FILE_FLAGS = {
    '--body-file': 'body', '--requirements-file': 'requirements', '--conditions-file': 'conditions',
  };
  const opts = {};
  const positionals = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--dry-run') { opts.dryRun = true; continue; }
    if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, t)) {
      const val = tokens[++i];
      if (val === undefined) throw new Error(`Missing value for ${t}`);
      opts[VALUE_FLAGS[t]] = val;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(FILE_FLAGS, t)) {
      const val = tokens[++i];
      if (val === undefined) throw new Error(`Missing path for ${t}`);
      opts[FILE_FLAGS[t]] = fs.readFileSync(val, 'utf8');
      continue;
    }
    if (t.startsWith('--')) throw new Error(`Unknown flag: ${t}`);
    positionals.push(t);
  }
  if (positionals.length > 1) throw new Error(`Unexpected extra argument: ${positionals[1]}`);
  opts.vacancy = positionals[0];
  if (!opts.vacancy) throw new Error('update-vacancy requires <vacancy_id>');
  return opts;
}

async function cmdCloseReasons() { return api(acct('/vacancy_close_reasons')); }

// search <query> [--vacancy <id>] [--status <id>] [--tag <id>]: the filters are
// reserved words here, everything else is the query. Filters alone are enough.
function parseSearchOpts(tokens) {
  const opts = { filters: {} };
  const words = [];
  for (let i = 0; i < tokens.length; i++) {
    const name = ['--vacancy', '--status', '--tag'].find(f => f === tokens[i]);
    if (!name) { words.push(tokens[i]); continue; }
    const value = tokens[++i];
    if (!/^\d+$/.test(String(value))) throw new Error(`Invalid ${name}: ${value}`);
    opts.filters[name.slice(2)] = value;
  }
  opts.query = words.join(' ');
  if (!opts.query && !Object.keys(opts.filters).length) {
    throw new Error('Usage: search <query> [--vacancy <id>] [--status <id>] [--tag <id>]');
  }
  return opts;
}

async function cmdSearch(query, filters = {}) {
  const params = [`q=${encodeURIComponent(query)}`];
  for (const [k, v] of Object.entries(filters)) params.push(`${k}=${encodeURIComponent(v)}`);
  return api(acct(`/applicants/search?${params.join('&')}`));
}

async function cmdCoworkers() {
  const allItems = [];
  let page = 1;
  while (true) {
    const data = await api(acct(`/coworkers?page=${page}&count=100`));
    if (!Array.isArray(data.items)) break;
    allItems.push(...data.items);
    if (!data.total_pages || page >= data.total_pages) break;
    page++;
  }
  return allItems;
}

function formatCoworker(c) {
  return `[${c.id}] ${c.name || ''}${c.type ? ` | ${c.type}` : ''}${c.email ? ` | ${c.email}` : ''}`;
}

async function cmdDivisions() { return api(acct('/divisions')); }
async function cmdTags() { return api(acct('/tags')); }
async function cmdSources() { return api(acct('/applicants/sources')); }

// Optional default tag `add` applies (an ownership tag, say). Tag ids are
// per-account: set HUNTFLOW_DEFAULT_TAG_ID, or pass --tag / --no-tag per call.
const DEFAULT_TAG_ID = parseInt(process.env.HUNTFLOW_DEFAULT_TAG_ID || '', 10) || null;

// Map questionary field titles -> account-specific field keys, so callers can
// pass --linkedin/--github/--location without hardcoding the opaque keys.
async function resolveQuestionaryKeys() {
  const schema = await api(acct('/applicants/questionary'));
  const byTitle = {};
  for (const [key, field] of Object.entries(schema || {})) {
    if (field && field.title) byTitle[field.title.toLowerCase()] = key;
  }
  return byTitle;
}

// LinkedIn is a system source (foreign "LI"); resolve its id rather than hardcode.
async function resolveLinkedInSourceId() {
  const data = await api(acct('/applicants/sources'));
  const li = ((data && data.items) || []).find(s => s.foreign === 'LI');
  return li ? li.id : null;
}

// Create a lightweight applicant (name + optional position), set questionary
// fields, apply the ownership tag, set the source on the resume entry, and
// attach to a vacancy at a stage. Mirrors the manual API flow; each side effect
// uses the one endpoint that actually takes effect:
//   - tags: POST .../tags (create-body and PATCH silently drop the tag)
//   - source: PUT .../externals/<id> with a required `data` field (empty is fine)
//   - vacancy link: POST .../vacancy on a fresh applicant
async function cmdAdd(opts) {
  const firstName = opts.first;
  const lastName = opts.last;
  const vacancy = parseInt(opts.vacancy, 10);
  if (!firstName || !lastName) throw new Error('add requires <first_name> <last_name>');
  if (!Number.isInteger(vacancy)) throw new Error(`Invalid or missing --vacancy: ${opts.vacancy}`);

  let status = opts.status != null ? parseInt(opts.status, 10) : null;
  if (opts.status != null && !Number.isInteger(status)) throw new Error(`Invalid --status: ${opts.status}`);
  if (status == null) {
    const st = await cmdStatuses();
    if (!st.items || !st.items.length) throw new Error('No pipeline statuses found; pass --status explicitly');
    status = st.items[0].id; // first stage ("New")
  }

  const createBody = { first_name: firstName, last_name: lastName };
  if (opts.position) createBody.position = opts.position;
  const applicant = await api(acct('/applicants'), 'POST', JSON.stringify(createBody));
  const applicantId = applicant.id;
  if (!applicantId) throw new Error(`Applicant create returned no id: ${JSON.stringify(applicant)}`);

  // Primary email: PATCH after create (the create body silently drops it).
  // first_name/last_name are required on the PATCH.
  if (opts.email) {
    await api(acct(`/applicants/${num(applicantId)}`), 'PATCH',
      JSON.stringify({ first_name: firstName, last_name: lastName, email: opts.email }));
  }

  if (opts.linkedin || opts.github || opts.location || opts.email2) {
    const keys = await resolveQuestionaryKeys();
    const q = {};
    if (opts.linkedin && keys['linkedin']) q[keys['linkedin']] = opts.linkedin;
    if (opts.github && keys['github']) q[keys['github']] = opts.github;
    if (opts.location && keys['location']) q[keys['location']] = opts.location;
    // Secondary email lives in the "2nd Email" questionary field (additional info in the UI).
    if (opts.email2 && keys['2nd email']) q[keys['2nd email']] = opts.email2;
    if (Object.keys(q).length) {
      await api(acct(`/applicants/${num(applicantId)}/questionary`), 'POST', JSON.stringify(q));
    }
  }

  const tagId = opts.noTag ? null : (opts.tag != null ? parseInt(opts.tag, 10) : DEFAULT_TAG_ID);
  if (tagId == null && !opts.noTag) {
    console.error('note: no tag applied (set HUNTFLOW_DEFAULT_TAG_ID or pass --tag <id>)');
  }
  if (tagId != null) {
    if (!Number.isInteger(tagId)) throw new Error(`Invalid --tag: ${opts.tag}`);
    await api(acct(`/applicants/${num(applicantId)}/tags`), 'POST', JSON.stringify({ tags: [tagId] }));
  }

  let sourceId = opts.source != null ? parseInt(opts.source, 10) : await resolveLinkedInSourceId();
  if (opts.source != null && !Number.isInteger(sourceId)) throw new Error(`Invalid --source: ${opts.source}`);
  if (sourceId != null && applicant.external && applicant.external.length) {
    const extId = applicant.external[0].id;
    await api(acct(`/applicants/${num(applicantId)}/externals/${extId}`), 'PUT',
      JSON.stringify({ account_source: sourceId, data: { body: '' } }));
  }

  await api(acct(`/applicants/${num(applicantId)}/vacancy`), 'POST', JSON.stringify({ vacancy, status }));

  return { id: applicantId, vacancy, status, tag: tagId, source: sourceId };
}

// Parse `add` args: two positionals (<first> <last>) plus --flag value pairs and
// the boolean --no-tag.
function parseAddOpts(tokens) {
  const VALUE_FLAGS = {
    '--vacancy': 'vacancy', '--status': 'status', '--position': 'position',
    '--linkedin': 'linkedin', '--github': 'github', '--location': 'location',
    '--source': 'source', '--tag': 'tag', '--email': 'email', '--email2': 'email2',
  };
  const opts = {};
  const positionals = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--no-tag') { opts.noTag = true; continue; }
    if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, t)) {
      const val = tokens[++i];
      if (val === undefined) throw new Error(`Missing value for ${t}`);
      opts[VALUE_FLAGS[t]] = val;
      continue;
    }
    if (t.startsWith('--')) throw new Error(`Unknown flag: ${t}`);
    positionals.push(t);
  }
  opts.first = positionals[0];
  opts.last = positionals[1];
  return opts;
}

// --- Formatters ---

function formatVacancy(v) {
  const state = { OPEN: 'OPEN', CLOSED: 'CLOSED', HOLD: 'HOLD' }[v.state] || v.state;
  const money = v.money ? ` | ${v.money}` : '';
  return `[${v.id}] ${v.position}${money} (${state})`;
}

function formatApplicant(a) {
  return `[${a.id}] ${a.last_name || ''} ${a.first_name || ''} ${a.middle_name || ''}`.trim();
}

function formatPipelineApplicant(a) {
  const name = `${a.last_name || ''} ${a.first_name || ''} ${a.middle_name || ''}`.trim();
  const money = a.money ? ` | ${a.money}` : '';
  const created = a.created ? ` | ${a.created.split('T')[0]}` : '';
  const status = a.links && a.links.length ? ` status:${a.links[0].status}` : '';
  return `[${a.id}] ${name}${status}${money}${created}`;
}

function formatApplicantDetail(a) {
  const lines = [];
  lines.push(`ID: ${a.id}`);
  lines.push(`Name: ${a.last_name || ''} ${a.first_name || ''} ${a.middle_name || ''}`.trim());
  if (a.birthday) lines.push(`Birthday: ${a.birthday}`);
  if (a.phone) lines.push(`Phone: ${a.phone}`);
  if (a.email) lines.push(`Email: ${a.email}`);
  if (a.position) lines.push(`Position: ${a.position}`);
  if (a.company) lines.push(`Company: ${a.company}`);
  if (a.money) lines.push(`Salary: ${a.money}`);
  return lines.join('\n');
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  // Strip only the flags we actually define, so a query fragment that happens to
  // start with `--` (e.g. `search --foo`) still reaches the command.
  const KNOWN_FLAGS = new Set(['--json', '--open', '--mine']);
  const filteredArgs = args.filter(a => !KNOWN_FLAGS.has(a));
  const command = filteredArgs[0];

  try {
    let result;

    switch (command) {
      case 'me':
        result = await cmdMe();
        if (!jsonMode) { console.log(`${result.name} (${result.email})`); return; }
        break;

      case 'vacancies': {
        const onlyOpen = args.includes('--open');
        result = await cmdVacancies(onlyOpen, args.includes('--mine'));
        if (!jsonMode) {
          console.log(`Vacancies (${result.length}):\n`);
          result.forEach(v => console.log(formatVacancy(v)));
          return;
        }
        break;
      }

      case 'vacancy':
        if (!filteredArgs[1]) { console.error('Usage: vacancy <id>'); process.exit(1); }
        result = await cmdVacancy(filteredArgs[1]);
        if (!jsonMode) {
          console.log(`${result.position} [${result.id}]`);
          console.log(`State: ${result.state}`);
          if (result.money) console.log(`Money: ${result.money}`);
          if (result.body) console.log(`\nDescription:\n${result.body}`);
          return;
        }
        break;

      case 'pipeline': {
        if (!filteredArgs[1]) { console.error('Usage: pipeline <vacancy_id> [status_id]'); process.exit(1); }
        result = await cmdPipeline(filteredArgs[1], filteredArgs[2] || null);
        if (!jsonMode) {
          console.log(`Pipeline (${result.length}):\n`);
          result.forEach(a => console.log(formatPipelineApplicant(a)));
          return;
        }
        break;
      }

      case 'applicant':
        if (!filteredArgs[1]) { console.error('Usage: applicant <id>'); process.exit(1); }
        result = await cmdApplicant(filteredArgs[1]);
        if (!jsonMode) { console.log(formatApplicantDetail(result)); return; }
        break;

      case 'resume':
        if (!filteredArgs[1]) { console.error('Usage: resume <applicant_id>'); process.exit(1); }
        result = await cmdResume(filteredArgs[1]);
        if (!jsonMode) {
          if (!result.items.length) { console.log('No resume found'); return; }
          result.items.forEach((ext, i) => {
            console.log(`\n--- Resume ${i + 1} ---`);
            if (ext.data) {
              const d = ext.data;
              if (d.position) console.log(`Position: ${d.position}`);
              if (d.area) console.log(`Area: ${d.area.name || d.area}`);
            }
            if (ext.auth_type) console.log(`Source: ${ext.auth_type}`);
          });
          return;
        }
        break;

      case 'logs':
        if (!filteredArgs[1]) { console.error('Usage: logs <applicant_id>'); process.exit(1); }
        result = await cmdLogs(filteredArgs[1]);
        if (!jsonMode) {
          if (!result.items || !result.items.length) { console.log('No records'); return; }
          result.items.forEach(log => {
            const date = log.created ? log.created.split('T')[0] : '?';
            console.log(`${date} | ${log.type || ''} | ${log.comment || ''}`);
          });
          return;
        }
        break;

      case 'comments':
        if (!filteredArgs[1]) { console.error('Usage: comments <applicant_id>'); process.exit(1); }
        result = await cmdComments(filteredArgs[1]);
        if (!jsonMode) {
          // Email log entries come back as type COMMENT with a null `comment`; skip them.
          const texts = (result.items || []).filter(log => log.comment);
          if (!texts.length) { console.log('No comments'); return; }
          texts.forEach(log => {
            const date = log.created ? log.created.split('T')[0] : '?';
            console.log(`${date} | ${log.comment}`);
          });
          return;
        }
        break;

      case 'comment': {
        const opts = parseCommentOpts(filteredArgs.slice(1));
        result = await cmdComment(opts.applicant, opts.text, opts.vacancy);
        if (!jsonMode) { console.log(`Comment added to applicant [${opts.applicant}]`); return; }
        break;
      }

      case 'statuses':
        result = await cmdStatuses();
        if (!jsonMode) { result.items.forEach(s => console.log(`[${s.id}] ${s.name} (${s.type})`)); return; }
        break;

      case 'rejections':
        result = await cmdRejections();
        if (!jsonMode) { if (result.items) result.items.forEach(r => console.log(`[${r.id}] ${r.name}`)); return; }
        break;

      case 'move': {
        // Positionals: <aid> <vid> <sid> [rid]. Optional --comment <text> or
        // --comment-file <path> attaches a comment to the log entry (e.g. the
        // written rejection feedback); --comment-file avoids shell-quoting a
        // long multiline block, mirroring update-vacancy's --*-file flags.
        const movePos = [];
        let moveComment = null;
        for (let i = 1; i < filteredArgs.length; i++) {
          const t = filteredArgs[i];
          if (t === '--comment') { moveComment = filteredArgs[++i]; continue; }
          if (t === '--comment-file') { moveComment = fs.readFileSync(filteredArgs[++i], 'utf8'); continue; }
          movePos.push(t);
        }
        if (movePos.length < 3) {
          console.error('Usage: move <applicant_id> <vacancy_id> <status_id> [rejection_id] [--comment <text> | --comment-file <path>]');
          process.exit(1);
        }
        result = await cmdMove(movePos[0], movePos[1], movePos[2], movePos[3], moveComment);
        if (!jsonMode) { console.log('Applicant moved'); return; }
        break;
      }

      case 'close':
        if (!filteredArgs[1]) { console.error('Usage: close <vacancy_id> [close_reason_id]'); process.exit(1); }
        result = await cmdClose(filteredArgs[1], filteredArgs[2]);
        if (!jsonMode) { console.log(`Vacancy ${result.id} closed (state: ${result.state})`); return; }
        break;

      case 'update-vacancy': {
        const opts = parseUpdateVacancyOpts(filteredArgs.slice(1));
        result = await cmdUpdateVacancy(opts);
        if (!jsonMode) {
          const fields = Object.keys(opts).filter(k => k !== 'vacancy' && k !== 'dryRun');
          if (result.dryRun) {
            console.log(`Dry run — vacancy ${result.vacancy} not updated. Fields: ${fields.join(', ')}`);
            return;
          }
          console.log(`Updated vacancy [${result.id}] ${result.position} (fields: ${fields.join(', ')})`);
          return;
        }
        break;
      }

      case 'create-vacancy': {
        const opts = parseCreateVacancyOpts(filteredArgs.slice(1));
        result = await cmdCreateVacancy(opts);
        if (!jsonMode) {
          if (result.dryRun) {
            console.log('Dry run — not created. Request body:');
            console.log(JSON.stringify(result.body, null, 2));
            return;
          }
          console.log(
            `Created vacancy [${result.id}] ${result.position} (state: ${result.state})` +
            (result.account_division ? ` | division ${result.account_division}` : '')
          );
          return;
        }
        break;
      }

      case 'close-reasons':
        result = await cmdCloseReasons();
        if (!jsonMode) { if (result.items) result.items.forEach(r => console.log(`[${r.id}] ${r.name}`)); return; }
        break;

      case 'search': {
        const { query, filters } = parseSearchOpts(filteredArgs.slice(1));
        result = await cmdSearch(query, filters);
        if (!jsonMode) {
          if (!result.items || !result.items.length) { console.log('Nothing found'); return; }
          console.log(`Found: ${result.total_items || result.items.length}\n`);
          result.items.forEach(a => console.log(formatApplicant(a)));
          return;
        }
        break;
      }

      case 'coworkers':
        result = await cmdCoworkers();
        if (!jsonMode) {
          console.log(`Coworkers (${result.length}):\n`);
          result.forEach(c => console.log(formatCoworker(c)));
          return;
        }
        break;

      case 'divisions':
        result = await cmdDivisions();
        if (!jsonMode) { if (result.items) result.items.forEach(d => console.log(`[${d.id}] ${d.name}`)); return; }
        break;

      case 'tags':
        result = await cmdTags();
        if (!jsonMode) { if (result.items) result.items.forEach(t => console.log(`[${t.id}] ${t.name} (${t.color})`)); return; }
        break;

      case 'sources':
        result = await cmdSources();
        if (!jsonMode) { if (result.items) result.items.forEach(x => console.log(`[${x.id}] ${x.name} (${x.type})`)); return; }
        break;

      case 'add': {
        const opts = parseAddOpts(filteredArgs.slice(1));
        result = await cmdAdd(opts);
        if (!jsonMode) {
          console.log(
            `Added applicant [${result.id}] to vacancy ${result.vacancy} at status ${result.status}` +
            (result.tag ? ` | tag ${result.tag}` : '') +
            (result.source ? ` | source ${result.source}` : '')
          );
          return;
        }
        break;
      }

      case '-h':
      case '--help':
      default:
        console.log(`Huntflow ATS Helper

Set HUNTFLOW_ACCOUNT_ID env var, then:

  me                              Current user
  vacancies [--open] [--mine]     List vacancies (--mine = only yours)
  vacancy <id>                    Vacancy details
  pipeline <vacancy_id> [sid]     Candidates in vacancy pipeline (optional stage filter)
  applicant <id>                  Applicant details
  resume <applicant_id>           Applicant resume(s)
  logs <applicant_id>             Applicant pipeline history
  comments <applicant_id>         Comments on an applicant
  comment <applicant_id> <text> [--vacancy <vid>]   Add a comment (personal note without --vacancy; no edit or delete)
  statuses                        Pipeline stages
  rejections                      Rejection reasons
  move <aid> <vid> <sid> [rid] [--comment <t>|--comment-file <p>]  Move applicant to stage (optional comment on the log entry)
  create-vacancy <position> --deadline <YYYY-MM-DD> [opts]   Create a vacancy
      opts: --hire <n> (default: 1), --division <id>, --money <text>,
            --company <text>, --priority <0|1>, --state <OPEN|HOLD>, --hidden,
            --dry-run
  close <vid> [reason_id]          Close a vacancy (optional close reason)
  update-vacancy <id> [opts]      Update a vacancy (partial; only given fields change)
      opts: --body <html> | --body-file <path>, --requirements <html> | --requirements-file <path>,
            --conditions <html> | --conditions-file <path>, --money <text>, --position <text>,
            --state <OPEN|HOLD|CLOSED>, --dry-run
  close-reasons                   List vacancy close reasons
  search <query> [opts]           Search applicants (opts: --vacancy <id>, --status <id>, --tag <id>)
  coworkers                       Recruiters and other account members
  divisions                       Account divisions
  tags                            Account tags
  sources                         Resume sources (ids for --source)
  add <first> <last> --vacancy <vid> [opts]   Create applicant + attach to vacancy
      opts: --status <sid> (default: first stage), --position <text>,
            --linkedin <url>, --github <url>, --location <text>,
            --email <addr>, --email2 <addr> (secondary, "2nd Email" field),
            --source <src_id> (default: LinkedIn), --tag <tag_id>, --no-tag

Flags:
  --json    Machine-readable JSON output`);
        return;
    }

    if (jsonMode) console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    const title = err && err.body && err.body.errors && err.body.errors[0] && err.body.errors[0].title;
    const authFail = title === 'error.robot_token.not_found';

    if (jsonMode) {
      // Emit a parseable error on stderr so `--json` consumers get structured
      // output on failure too, not just on success. stdout stays clean.
      const payload = { error: true, code: authFail ? 'auth_expired' : 'error' };
      if (err && err.status) payload.status = err.status;
      if (err && err.body !== undefined) payload.body = err.body;
      else payload.message = (err && (err.message || String(err))) || 'unknown error';
      console.error(JSON.stringify(payload));
      process.exit(authFail ? 2 : 1);
    }

    if (err && err.body) {
      if (authFail) {
        console.error('Huntflow token is invalid or expired. Regenerate your API token in Huntflow, then run setup.sh to store the new pair.');
        process.exit(2); // 2 = auth/token failure, distinct from generic errors
      }
      console.error(`Error ${err.status}:`, JSON.stringify(err.body, null, 2));
    } else {
      console.error('Error:', err.message || err);
    }
    process.exit(1);
  }
}

// Export pure helpers for offline unit tests (test_huntflow.js); only run the
// CLI when invoked directly, not when required as a module.
if (require.main === module) {
  main();
} else {
  module.exports = {
    parseAddOpts,
    parseCommentOpts,
    parseSearchOpts,
    formatCoworker,
    formatVacancy,
    formatApplicant,
    formatPipelineApplicant,
    num,
  };
}
