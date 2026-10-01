/**
 * Offline unit tests for huntflow.js pure helpers (arg parsing + formatters).
 * No token or network needed. Uses Node's built-in test runner (no deps).
 *
 * Run directly (node test_huntflow.js) or via smoke_test.sh.
 */

const test = require('node:test');
const assert = require('node:assert');

const { parseAddOpts, parseCommentOpts, formatVacancy, formatApplicant, formatPipelineApplicant, parseSearchOpts, formatCoworker, num, splitArgs } = require('./huntflow.js');

test('parseAddOpts: two positionals become first/last', () => {
  const o = parseAddOpts(['Jane', 'Doe']);
  assert.strictEqual(o.first, 'Jane');
  assert.strictEqual(o.last, 'Doe');
});

test('parseAddOpts: value flags are captured', () => {
  const o = parseAddOpts([
    'John', 'Roe',
    '--vacancy', '1001',
    '--position', 'Senior Data Engineer',
    '--linkedin', 'https://linkedin.com/in/x',
    '--location', 'Lisbon, Portugal',
    '--source', '2002',
    '--tag', '3003',
  ]);
  assert.strictEqual(o.vacancy, '1001');
  assert.strictEqual(o.position, 'Senior Data Engineer');
  assert.strictEqual(o.linkedin, 'https://linkedin.com/in/x');
  assert.strictEqual(o.location, 'Lisbon, Portugal');
  assert.strictEqual(o.source, '2002');
  assert.strictEqual(o.tag, '3003');
});

test('parseAddOpts: --email and --email2 are captured', () => {
  const o = parseAddOpts([
    'A', 'B', '--email', 'primary@x.com', '--email2', 'alt@y.io',
  ]);
  assert.strictEqual(o.email, 'primary@x.com');
  assert.strictEqual(o.email2, 'alt@y.io');
});

test('parseAddOpts: --no-tag is a boolean, not a value flag', () => {
  const o = parseAddOpts(['A', 'B', '--no-tag', '--vacancy', '1']);
  assert.strictEqual(o.noTag, true);
  assert.strictEqual(o.vacancy, '1'); // --no-tag did not swallow the next token
});

test('parseAddOpts: a value flag with no value throws', () => {
  assert.throws(() => parseAddOpts(['A', 'B', '--email']), /Missing value for --email/);
});

test('parseAddOpts: an unknown flag throws', () => {
  assert.throws(() => parseAddOpts(['A', 'B', '--nope', 'x']), /Unknown flag: --nope/);
});

test('parseAddOpts: a value that looks flag-like is still taken literally', () => {
  // Values are read positionally after their flag, so this is accepted as-is.
  const o = parseAddOpts(['A', 'B', '--position', 'Lead']);
  assert.strictEqual(o.position, 'Lead');
});

test('formatVacancy: includes money only when present', () => {
  assert.strictEqual(
    formatVacancy({ id: 1, position: 'DE', state: 'OPEN', money: '$5k' }),
    '[1] DE | $5k (OPEN)',
  );
  assert.strictEqual(
    formatVacancy({ id: 2, position: 'DE', state: 'CLOSED' }),
    '[2] DE (CLOSED)',
  );
});

test('formatApplicant: trims missing name parts', () => {
  assert.strictEqual(
    formatApplicant({ id: 9, last_name: 'Doe', first_name: 'Jane' }),
    '[9] Doe Jane',
  );
  assert.strictEqual(formatApplicant({ id: 9, last_name: 'Solo' }), '[9] Solo');
});

test('formatPipelineApplicant: composes status, money, and created date', () => {
  assert.strictEqual(
    formatPipelineApplicant({
      id: 3, last_name: 'X', first_name: 'Y',
      money: '$1', created: '2026-07-30T10:00:00Z',
      links: [{ status: 101 }],
    }),
    '[3] X Y status:101 | $1 | 2026-07-30',
  );
});

test('parseCommentOpts: id first, rest is the text, --vacancy is pulled out', () => {
  const o = parseCommentOpts(['123', 'Strong', 'SQL', '--vacancy', '456']);
  assert.deepStrictEqual(o, { vacancy: '456', applicant: '123', text: 'Strong SQL' });
  assert.throws(() => parseCommentOpts(['123']), /Usage/);
});

test('parseSearchOpts: query words and filters are separated', () => {
  const o = parseSearchOpts(['jane', 'doe', '--vacancy', '1001', '--tag', '3003']);
  assert.strictEqual(o.query, 'jane doe');
  assert.deepStrictEqual(o.filters, { vacancy: '1001', tag: '3003' });
});

test('parseSearchOpts: filters alone are enough; nothing at all, or a non-numeric filter, throws', () => {
  assert.strictEqual(parseSearchOpts(['--status', '101']).query, '');
  assert.throws(() => parseSearchOpts([]), /Usage/);
  assert.throws(() => parseSearchOpts(['x', '--vacancy', '1&tag=2']), /Invalid --vacancy/);
  assert.throws(() => parseSearchOpts(['x', '--tag']), /Invalid --tag/);
});

test('formatCoworker: id, name, and whatever else is present', () => {
  assert.strictEqual(formatCoworker({ id: 5, name: 'Jane Doe', type: 'owner', email: 'j@example.com' }), '[5] Jane Doe | owner | j@example.com');
  assert.strictEqual(formatCoworker({ id: 6, name: 'John Roe' }), '[6] John Roe');
});

test('num: digits pass, anything that could change a URL path throws', () => {
  assert.strictEqual(num('123'), '123');
  assert.strictEqual(num(123), 123);
  for (const bad of ['1/../x', '1?x=2', 'abc', '', '-1', '1 2', '1\n']) {
    assert.throws(() => num(bad), /Invalid id/, JSON.stringify(bad));
  }
});

test('splitArgs: known flags are stripped, text after -- is kept literally', () => {
  const a = splitArgs(['comment', '5', '--', 'note', 'about', '--json', 'output']);
  assert.deepStrictEqual(a.filteredArgs, ['comment', '5', 'note', 'about', '--json', 'output']);
  assert.strictEqual(a.jsonMode, false);
  const b = splitArgs(['vacancies', '--open', '--json']);
  assert.deepStrictEqual(b.filteredArgs, ['vacancies']);
  assert.strictEqual(b.jsonMode, true);
});
