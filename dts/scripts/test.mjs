/**
 * test.mjs -- automated test suite.
 *
 * Run with the application server already running:
 *     npm run build && npm start &
 *     npm test
 *
 * Four groups are covered: database integrity, the analytical functions,
 * authentication and access control, and the HTTP interface.
 */
import pg from 'pg';

const BASE = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000';
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }

const db = new pg.Client({
  connectionString: url,
  ssl: url.includes('supabase') ? { rejectUnauthorized: false } : false,
});
await db.connect();

let passed = 0, failed = 0;
const failures = [];
let group = '';

const heading = (g) => { group = g; console.log(`\n${g}`); };

async function test(name, fn) {
  try {
    await fn();
    passed++; console.log(`  pass  ${name}`);
  } catch (err) {
    failed++; failures.push(`${group} / ${name}: ${err.message}`);
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function equal(a, b, msg) {
  if (String(a) !== String(b)) throw new Error(msg || `expected ${b}, received ${a}`);
}
async function rejects(promise, fragment) {
  try { await promise; }
  catch (err) {
    if (fragment && !err.message.toLowerCase().includes(fragment.toLowerCase())) {
      throw new Error(`rejected, but for the wrong reason: ${err.message}`);
    }
    return;
  }
  throw new Error('expected the operation to be rejected, but it succeeded');
}

// ---------------------------------------------------------------------
heading('Database integrity');

const ids = {};
{
  const r = await db.query(`SELECT
    (SELECT id FROM diseases    WHERE code='MAL')  AS mal,
    (SELECT id FROM diseases    WHERE code='CHO')  AS cho,
    (SELECT id FROM diseases    WHERE code='LAS')  AS las,
    (SELECT id FROM departments WHERE code='GOPD') AS gopd,
    (SELECT id FROM age_groups  ORDER BY sort_order LIMIT 1) AS age,
    (SELECT id FROM periods     ORDER BY ordinal DESC LIMIT 1) AS period`);
  Object.assign(ids, r.rows[0]);
}

await test('a negative case count is rejected', () =>
  rejects(db.query(
    `INSERT INTO case_counts (disease_id, period_id, department_id, age_group_id, sex, case_count)
     VALUES ($1,$2,$3,$4,'M',-5)`,
    [ids.mal, ids.period, ids.gopd, ids.age]), 'chk_count_non_negative'));

await test('an implausibly large count is rejected', () =>
  rejects(db.query(
    `INSERT INTO case_counts (disease_id, period_id, department_id, age_group_id, sex, case_count)
     VALUES ($1,$2,$3,$4,'M',500000)`,
    [ids.mal, ids.period, ids.gopd, ids.age]), 'chk_count_plausible'));

await test('an invalid sex value is rejected', () =>
  rejects(db.query(
    `INSERT INTO case_counts (disease_id, period_id, department_id, age_group_id, sex, case_count)
     VALUES ($1,$2,$3,$4,'X',1)`,
    [ids.mal, ids.period, ids.gopd, ids.age]), 'chk_sex'));

await test('the same cell cannot be entered twice', () =>
  rejects(db.query(
    `INSERT INTO case_counts (disease_id, period_id, department_id, age_group_id, sex, case_count)
     VALUES ($1,$2,$3,$4,'M',7)`,
    [ids.mal, ids.period, ids.gopd, ids.age]), 'uq_case_cell'));

await test('an invalid month is rejected', () =>
  rejects(db.query(`INSERT INTO periods (year, month) VALUES (2026, 13)`), 'chk_period_month'));

await test('an unknown role is rejected', () =>
  rejects(db.query(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES ('T','t@x.ng','h','superuser')`), 'chk_users_role'));

await test('a count cannot reference a disease that does not exist', () =>
  rejects(db.query(
    `INSERT INTO case_counts (disease_id, period_id, department_id, age_group_id, sex, case_count)
     VALUES (999999,$1,$2,$3,'F',1)`,
    [ids.period, ids.gopd, ids.age]), 'foreign key'));

await test('the schema holds no column capable of storing a patient identifier', async () => {
  const r = await db.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public'
        AND (column_name ILIKE '%patient%' OR column_name ILIKE '%surname%'
          OR column_name ILIKE '%hospital_num%' OR column_name ILIKE '%date_of_birth%'
          OR column_name ILIKE '%address%' OR column_name ILIKE '%phone%')`);
  equal(r.rowCount, 0, `found identifying columns: ${JSON.stringify(r.rows)}`);
});

await test('updated_at moves when a count is corrected', async () => {
  const before = await db.query(
    `SELECT id, updated_at FROM case_counts ORDER BY id LIMIT 1`);
  await new Promise(r => setTimeout(r, 20));
  await db.query(`UPDATE case_counts SET case_count = case_count WHERE id=$1`, [before.rows[0].id]);
  const after = await db.query(`SELECT updated_at FROM case_counts WHERE id=$1`, [before.rows[0].id]);
  assert(new Date(after.rows[0].updated_at) > new Date(before.rows[0].updated_at),
    'the trigger did not update the timestamp');
});

// ---------------------------------------------------------------------
heading('Analytical functions');

await test('vw_monthly_totals equals the sum of its underlying rows', async () => {
  const r = await db.query(
    `SELECT (SELECT COALESCE(SUM(total_cases),0) FROM vw_monthly_totals) AS view_total,
            (SELECT COALESCE(SUM(case_count),0)  FROM case_counts)       AS raw_total`);
  equal(r.rows[0].view_total, r.rows[0].raw_total, 'the view and the table disagree');
});

await test('the baseline uses the same calendar month in earlier years only', async () => {
  const period = await db.query(
    `SELECT year, month FROM periods ORDER BY ordinal DESC LIMIT 1`);
  const { year, month } = period.rows[0];

  const fn = await db.query(`SELECT * FROM fn_baseline($1,$2::SMALLINT,$3::SMALLINT)`,
    [ids.mal, year, month]);
  const manual = await db.query(
    `SELECT ROUND(AVG(total_cases),2) AS mean, COUNT(*)::INTEGER AS n
       FROM vw_monthly_totals WHERE disease_id=$1 AND month=$2 AND year<$3`,
    [ids.mal, month, year]);

  equal(fn.rows[0].baseline_mean, manual.rows[0].mean, 'the mean does not match');
  equal(fn.rows[0].years_in_baseline, manual.rows[0].n, 'the year count does not match');
});

await test('the baseline never includes the month being tested', async () => {
  const p = await db.query(`SELECT year, month FROM periods ORDER BY ordinal DESC LIMIT 1`);
  const r = await db.query(`SELECT * FROM fn_baseline($1,$2::SMALLINT,$3::SMALLINT)`,
    [ids.mal, p.rows[0].year, p.rows[0].month]);
  const years = await db.query(
    `SELECT COUNT(*)::INTEGER AS n FROM vw_monthly_totals
      WHERE disease_id=$1 AND month=$2 AND year<$3`,
    [ids.mal, p.rows[0].month, p.rows[0].year]);
  equal(r.rows[0].years_in_baseline, years.rows[0].n, 'the current month leaked into its own baseline');
});

await test('a seasonal disease has a genuinely seasonal profile', async () => {
  const r = await db.query(
    `SELECT month, mean_cases FROM vw_seasonal_profile WHERE disease_id=$1 ORDER BY mean_cases DESC`,
    [ids.mal]);
  const peak = Number(r.rows[0].mean_cases);
  const trough = Number(r.rows[r.rows.length - 1].mean_cases);
  assert(peak > trough * 1.8,
    `malaria peak ${peak} is not clearly above its trough ${trough}`);
  assert([6,7,8,9].includes(r.rows[0].month),
    `malaria peaks in month ${r.rows[0].month}, which is not the rainy season`);
});

await test('every injected outbreak was detected', async () => {
  const expected = [['CHO',2026,7],['CHO',2026,8],['LAS',2026,2],['MEA',2026,3],['DIA',2026,7]];
  const missed = [];
  for (const [code, year, month] of expected) {
    const r = await db.query(
      `SELECT 1 FROM alerts a
         JOIN diseases d ON d.id=a.disease_id
         JOIN periods  p ON p.id=a.period_id
        WHERE d.code=$1 AND p.year=$2 AND p.month=$3`, [code, year, month]);
    if (r.rowCount === 0) missed.push(`${code} ${year}-${month}`);
  }
  equal(missed.length, 0, `not detected: ${missed.join(', ')}`);
});

await test('no alert rests on fewer than two years of history', async () => {
  const r = await db.query(`SELECT COUNT(*)::INTEGER AS n FROM alerts WHERE years_in_baseline < 2`);
  equal(r.rows[0].n, 0, 'an alert was raised without a defensible baseline');
});

await test('every stored alert genuinely exceeds its threshold', async () => {
  const r = await db.query(
    `SELECT COUNT(*)::INTEGER AS n FROM alerts WHERE observed <= threshold`);
  equal(r.rows[0].n, 0, 'an alert was stored for a count below its own threshold');
});

await test('a stricter multiplier raises no more alerts than a lenient one', async () => {
  const p = await db.query(`SELECT id FROM periods WHERE year=2026 AND month=7`);
  const lenient = await db.query(`SELECT fn_evaluate_period($1, 1.5) AS n`, [p.rows[0].id]);
  const strict  = await db.query(`SELECT fn_evaluate_period($1, 3.5) AS n`, [p.rows[0].id]);
  assert(Number(strict.rows[0].n) <= Number(lenient.rows[0].n),
    `3.5 SD flagged ${strict.rows[0].n} but 1.5 SD flagged ${lenient.rows[0].n}`);
  await db.query(`SELECT fn_evaluate_period($1, 2.0)`, [p.rows[0].id]); // restore
});

await test('an unknown period is refused by the evaluation function', () =>
  rejects(db.query(`SELECT fn_evaluate_period(999999, 2.0)`), 'Unknown period'));

await test('reporting completeness never exceeds one hundred per cent', async () => {
  const r = await db.query(
    `SELECT COUNT(*)::INTEGER AS n FROM vw_reporting_completeness WHERE completeness_pct > 100`);
  equal(r.rows[0].n, 0, 'completeness exceeded 100 per cent');
});

await test('missing returns are visible as missing', async () => {
  const r = await db.query(
    `SELECT COUNT(*)::INTEGER AS n FROM vw_reporting_completeness WHERE submitted < expected`);
  assert(r.rows[0].n > 0, 'the completeness view reports no gaps at all, which is implausible');
});

// ---------------------------------------------------------------------
heading('Authentication and access control');

const login = async (email, password) => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { res, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? null };
};

let adminCookie = null, recordsCookie = null, viewerCookie = null;

await test('passwords are stored only as hashes', async () => {
  const r = await db.query(`SELECT password_hash FROM users`);
  for (const row of r.rows) {
    assert(row.password_hash.startsWith('$2'), 'a password is not bcrypt hashed');
    assert(!/Admin@2026|Records@2026|Viewer@2026/.test(row.password_hash),
      'a plaintext password appears in the database');
  }
});

await test('a valid administrator sign in succeeds', async () => {
  const { res, cookie } = await login('admin@ubth.edu.ng', 'Admin@2026');
  equal(res.status, 200);
  assert(cookie, 'no session cookie was issued');
  adminCookie = cookie;
});

await test('the session cookie is httpOnly', async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@ubth.edu.ng', password: 'Admin@2026' }),
  });
  assert(/httponly/i.test(res.headers.get('set-cookie') ?? ''),
    'the session cookie is readable by page scripts');
});

await test('a wrong password is refused', async () => {
  const { res } = await login('admin@ubth.edu.ng', 'wrong-password');
  equal(res.status, 401);
});

await test('an unknown email gives the same message as a wrong password', async () => {
  const a = await login('nobody@ubth.edu.ng', 'whatever12');
  const b = await login('admin@ubth.edu.ng', 'wrong-password');
  const [ja, jb] = [await a.res.json(), await b.res.json()];
  equal(ja.error, jb.error, 'the responses differ, so accounts can be enumerated');
});

await test('the other two roles can sign in', async () => {
  const r = await login('records@ubth.edu.ng', 'Records@2026');
  const v = await login('viewer@ubth.edu.ng', 'Viewer@2026');
  equal(r.res.status, 200); equal(v.res.status, 200);
  recordsCookie = r.cookie; viewerCookie = v.cookie;
});

await test('a failed sign in is written to the audit log', async () => {
  await login('admin@ubth.edu.ng', 'definitely-wrong');
  const r = await db.query(
    `SELECT COUNT(*)::INTEGER AS n FROM audit_log WHERE action='login_failed'`);
  assert(r.rows[0].n > 0, 'no failed sign in was recorded');
});

// ---------------------------------------------------------------------
heading('HTTP interface');

const get = (path, cookie) =>
  fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
const post = (path, cookie, body) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

await test('data routes refuse an unauthenticated request', async () => {
  const res = await get('/api/analysis?view=summary');
  equal(res.status, 401);
});

await test('a page request without a session is redirected to sign in', async () => {
  const res = await fetch(`${BASE}/`, { redirect: 'manual' });
  assert([302, 307].includes(res.status), `expected a redirect, received ${res.status}`);
  assert((res.headers.get('location') ?? '').includes('/login'), 'not redirected to sign in');
});

await test('the dashboard summary returns the expected shape', async () => {
  const res = await get('/api/analysis?view=summary', adminCookie);
  equal(res.status, 200);
  const d = await res.json();
  assert(d.latest && typeof d.totalCases === 'number', 'the summary is malformed');
  assert(d.completeness, 'completeness is missing from the summary');
});

await test('the trend series is returned in month order', async () => {
  const res = await get('/api/analysis?view=trend', adminCookie);
  const d = await res.json();
  assert(d.series.length > 24, 'too few months returned');
  for (let i = 1; i < d.series.length; i++) {
    const prev = d.series[i - 1], cur = d.series[i];
    assert(cur.year * 12 + cur.month > prev.year * 12 + prev.month, 'the series is out of order');
  }
});

await test('the seasonal view refuses to run without a disease', async () => {
  const res = await get('/api/analysis?view=seasonal', adminCookie);
  equal(res.status, 400);
});

await test('an unknown view is refused', async () => {
  const res = await get('/api/analysis?view=nonsense', adminCookie);
  equal(res.status, 400);
});

await test('a medical officer cannot write a return', async () => {
  const res = await post('/api/returns', viewerCookie, {
    departmentId: ids.gopd, year: 2026, month: 8,
    cells: [{ diseaseId: ids.mal, ageGroupId: ids.age, sex: 'M', count: 5 }],
  });
  equal(res.status, 403);
});

await test('a records officer can write a return', async () => {
  const res = await post('/api/returns', recordsCookie, {
    departmentId: ids.gopd, year: 2026, month: 8,
    cells: [{ diseaseId: ids.mal, ageGroupId: ids.age, sex: 'M', count: 42 }],
  });
  equal(res.status, 200);
  const check = await db.query(
    `SELECT c.case_count FROM case_counts c JOIN periods p ON p.id=c.period_id
      WHERE c.disease_id=$1 AND c.department_id=$2 AND c.age_group_id=$3
        AND c.sex='M' AND p.year=2026 AND p.month=8`, [ids.mal, ids.gopd, ids.age]);
  equal(check.rows[0].case_count, 42, 'the value was not persisted');
});

await test('a negative count is refused by the interface', async () => {
  const res = await post('/api/returns', recordsCookie, {
    departmentId: ids.gopd, year: 2026, month: 8,
    cells: [{ diseaseId: ids.mal, ageGroupId: ids.age, sex: 'M', count: -3 }],
  });
  equal(res.status, 400);
});

await test('a fractional count is refused', async () => {
  const res = await post('/api/returns', recordsCookie, {
    departmentId: ids.gopd, year: 2026, month: 8,
    cells: [{ diseaseId: ids.mal, ageGroupId: ids.age, sex: 'M', count: 3.7 }],
  });
  equal(res.status, 400);
});

await test('an impossible month is refused', async () => {
  const res = await post('/api/returns', recordsCookie, {
    departmentId: ids.gopd, year: 2026, month: 19, cells: [],
  });
  equal(res.status, 400);
});

await test('an attempted SQL injection is treated as data, not code', async () => {
  const res = await post('/api/auth/login', null, {
    email: "admin@ubth.edu.ng' OR '1'='1", password: "' OR '1'='1",
  });
  equal(res.status, 401);
  const still = await db.query(`SELECT COUNT(*)::INTEGER AS n FROM users`);
  assert(still.rows[0].n >= 3, 'the users table was damaged');
});

await test('only an administrator may list accounts', async () => {
  equal((await get('/api/admin/users', recordsCookie)).status, 403);
  equal((await get('/api/admin/users', adminCookie)).status, 200);
});

await test('a duplicate email is refused when creating an account', async () => {
  const res = await post('/api/admin/users', adminCookie, {
    fullName: 'Duplicate', email: 'admin@ubth.edu.ng', password: 'Password123', role: 'viewer',
  });
  equal(res.status, 409);
});

await test('a short password is refused when creating an account', async () => {
  const res = await post('/api/admin/users', adminCookie, {
    fullName: 'Short', email: 'short@ubth.edu.ng', password: 'abc', role: 'viewer',
  });
  equal(res.status, 400);
});

await test('a medical officer cannot review a signal', async () => {
  const a = await db.query(`SELECT id FROM alerts LIMIT 1`);
  const res = await post('/api/alerts', viewerCookie, {
    action: 'review', alertId: a.rows[0].id, status: 'closed',
  });
  equal(res.status, 403);
});

await test('a records officer can review a signal and the change is recorded', async () => {
  const a = await db.query(`SELECT id FROM alerts WHERE status='open' LIMIT 1`);
  const res = await post('/api/alerts', recordsCookie, {
    action: 'review', alertId: a.rows[0].id, status: 'investigating', note: 'Checked against register',
  });
  equal(res.status, 200);
  const after = await db.query(`SELECT status, reviewed_by FROM alerts WHERE id=$1`, [a.rows[0].id]);
  equal(after.rows[0].status, 'investigating');
  assert(after.rows[0].reviewed_by, 'the reviewer was not recorded');
  await db.query(`UPDATE alerts SET status='open', reviewed_by=NULL WHERE id=$1`, [a.rows[0].id]);
});

await test('an out of range multiplier is refused', async () => {
  const res = await post('/api/alerts', recordsCookie, {
    action: 'evaluate', year: 2026, month: 7, multiplier: 12,
  });
  equal(res.status, 400);
});

// ---------------------------------------------------------------------
await db.end();

console.log(`\n${'-'.repeat(56)}`);
console.log(`${passed + failed} tests, ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ${f}`));
  process.exit(1);
}
console.log('All tests passed.');
