/**
 * seed.mjs -- populates the system with demonstration data.
 *
 * The figures produced here are SIMULATED. They reproduce the seasonal
 * shape reported for southern Nigeria (malaria and diarrhoeal disease
 * rising with the rains, Lassa fever and respiratory infection rising
 * in the dry season) so that the analytical features can be exercised
 * and demonstrated. They are not University of Benin Teaching Hospital
 * figures and must be replaced with the facility's own returns before
 * any epidemiological claim is made. This is stated in Chapter Four.
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes('supabase') ? { rejectUnauthorized: false } : false,
});

// deterministic generator so the demonstration is reproducible
let seed = 20260910;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const noise = (spread) => 1 + (rand() - 0.5) * 2 * spread;
const round = (n) => Math.max(0, Math.round(n));

const START_YEAR = 2022, START_MONTH = 1;
const END_YEAR = 2026,  END_MONTH  = 8;

// month multipliers, January to December
const PROFILE = {
  MAL: { base: 620, season: [0.55,0.50,0.60,0.85,1.15,1.45,1.60,1.55,1.40,1.15,0.80,0.60], trend:  0.00, depts:['GOPD','A&E','PAED','CHC'], age:[.34,.24,.24,.12,.06] },
  TYP: { base: 145, season: [0.70,0.65,0.75,0.95,1.15,1.30,1.35,1.30,1.20,1.05,0.85,0.75], trend:  0.01, depts:['GOPD','MED','CHC'],        age:[.10,.28,.42,.15,.05] },
  DIA: { base: 190, season: [0.60,0.55,0.70,0.95,1.25,1.50,1.55,1.40,1.25,1.00,0.75,0.60], trend: -0.02, depts:['GOPD','PAED','A&E','CHC'], age:[.52,.18,.16,.09,.05] },
  ARI: { base: 240, season: [1.35,1.30,1.05,0.80,0.65,0.60,0.60,0.65,0.80,1.00,1.25,1.45], trend:  0.01, depts:['GOPD','PAED','MED','CHC'], age:[.40,.20,.18,.13,.09] },
  CHO: { base:   6, season: [0.30,0.30,0.40,0.70,1.30,1.80,1.90,1.60,1.30,0.90,0.50,0.30], trend:  0.00, depts:['A&E','GOPD'],              age:[.28,.20,.32,.14,.06] },
  LAS: { base:  11, season: [1.70,1.75,1.50,1.05,0.60,0.40,0.35,0.35,0.45,0.65,1.05,1.45], trend:  0.03, depts:['A&E','MED'],               age:[.12,.18,.44,.19,.07] },
  MEA: { base:  17, season: [1.45,1.55,1.50,1.25,0.85,0.55,0.45,0.45,0.55,0.75,1.05,1.30], trend: -0.03, depts:['PAED','GOPD'],             age:[.66,.24,.07,.02,.01] },
  HTN: { base: 310, season: [1.02,0.98,1.00,1.01,0.99,0.97,1.00,1.02,1.01,1.00,0.99,1.01], trend:  0.05, depts:['GOPD','MED','CHC'],        age:[.00,.01,.22,.47,.30] },
  DM:  { base: 165, season: [1.01,0.99,1.00,1.02,0.98,0.99,1.01,1.00,1.02,0.99,1.00,0.99], trend:  0.06, depts:['GOPD','MED'],              age:[.01,.03,.26,.44,.26] },
  ANA: { base: 130, season: [0.85,0.85,0.90,1.00,1.10,1.20,1.20,1.15,1.05,1.00,0.90,0.85], trend:  0.00, depts:['GOPD','O&G','PAED','MED'], age:[.30,.16,.34,.13,.07] },
};

const SEX_SPLIT = { MAL:.49, TYP:.50, DIA:.51, ARI:.51, CHO:.52, LAS:.48, MEA:.52, HTN:.45, DM:.47, ANA:.34 };

// Deliberate excursions, so the detection rule has something real to find.
// Each is a plausible event: a cholera cluster after flooding, the annual
// Lassa season running unusually hot, and a measles cluster.
const EXCURSIONS = [
  { code:'CHO', year:2026, month:7, factor:6.5 },
  { code:'CHO', year:2026, month:8, factor:4.2 },
  { code:'LAS', year:2026, month:2, factor:2.9 },
  { code:'MEA', year:2026, month:3, factor:3.1 },
  { code:'DIA', year:2026, month:7, factor:1.9 },
];

function monthsBetween() {
  const out = [];
  let y = START_YEAR, m = START_MONTH;
  while (y < END_YEAR || (y === END_YEAR && m <= END_MONTH)) {
    out.push([y, m]);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

await client.connect();
console.log('Seeding. This replaces any existing case data.');

await client.query('TRUNCATE alerts, case_counts, return_status RESTART IDENTITY');

// ---- accounts -------------------------------------------------------
const accounts = [
  ['Dr. Adaeze N. Okafor',  'admin@ubth.edu.ng',   'Admin@2026',   'administrator'],
  ['Mrs. Grace Idahosa',    'records@ubth.edu.ng', 'Records@2026', 'records_officer'],
  ['Dr. Osaze Ehimare',     'viewer@ubth.edu.ng',  'Viewer@2026',  'viewer'],
];
for (const [name, email, pw, role] of accounts) {
  const hash = await bcrypt.hash(pw, 10);
  await client.query(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
                                       full_name     = EXCLUDED.full_name,
                                       role          = EXCLUDED.role`,
    [name, email, hash, role]);
}
console.log(`  ${accounts.length} accounts ready`);

// ---- periods --------------------------------------------------------
const months = monthsBetween();
for (const [y, m] of months) {
  await client.query('INSERT INTO periods (year, month) VALUES ($1,$2) ON CONFLICT DO NOTHING', [y, m]);
}
const { rows: periods }  = await client.query('SELECT id, year, month FROM periods ORDER BY ordinal');
const { rows: diseases } = await client.query('SELECT id, code FROM diseases');
const { rows: depts }    = await client.query('SELECT id, code FROM departments');
const { rows: ages }     = await client.query('SELECT id, sort_order FROM age_groups ORDER BY sort_order');

const periodOf = new Map(periods.map(p => [`${p.year}-${p.month}`, p.id]));
const diseaseOf = new Map(diseases.map(d => [d.code, d.id]));
const deptOf = new Map(depts.map(d => [d.code, d.id]));
const recordsOfficer = (await client.query(
  `SELECT id FROM users WHERE email='records@ubth.edu.ng'`)).rows[0].id;

// ---- case counts ----------------------------------------------------
const values = [];
let elapsed = 0;
for (const [year, month] of months) {
  const periodId = periodOf.get(`${year}-${month}`);
  for (const [code, cfg] of Object.entries(PROFILE)) {
    const diseaseId = diseaseOf.get(code);
    if (!diseaseId) continue;

    let monthly = cfg.base * cfg.season[month - 1] * (1 + cfg.trend * (elapsed / 12)) * noise(0.12);
    for (const ex of EXCURSIONS) {
      if (ex.code === code && ex.year === year && ex.month === month) monthly *= ex.factor;
    }

    // split across departments, then age bands, then sex
    const share = cfg.depts.map(() => 0.6 + rand() * 0.8);
    const shareTotal = share.reduce((a, b) => a + b, 0);

    cfg.depts.forEach((dcode, di) => {
      const deptId = deptOf.get(dcode);
      if (!deptId) return;
      const deptCases = monthly * (share[di] / shareTotal);

      ages.forEach((a, ai) => {
        const ageCases = deptCases * cfg.age[ai];
        if (ageCases < 0.05) {
          for (const sex of ['M', 'F']) values.push([diseaseId, periodId, deptId, a.id, sex, 0]);
          return;
        }
        const maleShare = SEX_SPLIT[code] * noise(0.06);
        const male = round(ageCases * maleShare);
        const female = round(ageCases * (1 - maleShare));
        values.push([diseaseId, periodId, deptId, a.id, 'M', male]);
        values.push([diseaseId, periodId, deptId, a.id, 'F', female]);
      });
    });
  }

  // every active department is marked as having submitted, except two
  // deliberate gaps so the completeness indicator has something to show
  for (const d of depts) {
    const gap = (year === 2026 && month === 8 && d.code === 'O&G')
             || (year === 2025 && month === 11 && d.code === 'CHC');
    await client.query(
      `INSERT INTO return_status (department_id, period_id, status, submitted_by, submitted_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (department_id, period_id) DO UPDATE SET status = EXCLUDED.status`,
      [d.id, periodId, gap ? 'pending' : 'submitted', gap ? null : recordsOfficer,
       gap ? null : new Date(year, month, 4)]);
  }
  elapsed += 1;
}

// batch insert
const CHUNK = 900;
for (let i = 0; i < values.length; i += CHUNK) {
  const slice = values.slice(i, i + CHUNK);
  const params = [];
  const tuples = slice.map((v, k) => {
    const b = k * 6;
    params.push(...v);
    return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},${recordsOfficer})`;
  });
  await client.query(
    `INSERT INTO case_counts
       (disease_id, period_id, department_id, age_group_id, sex, case_count, entered_by)
     VALUES ${tuples.join(',')}
     ON CONFLICT (disease_id, period_id, department_id, age_group_id, sex)
     DO UPDATE SET case_count = EXCLUDED.case_count`, params);
}
console.log(`  ${values.length} case count rows written across ${months.length} months`);

// ---- run the detection rule over the last two years ------------------
let flagged = 0;
for (const p of periods.filter(p => p.year >= START_YEAR + 2)) {
  const r = await client.query('SELECT fn_evaluate_period($1, $2) AS n', [p.id, 2.0]);
  flagged += r.rows[0].n;
}
console.log(`  ${flagged} alerts raised by fn_evaluate_period at 2.0 standard deviations`);

await client.query(
  `INSERT INTO audit_log (user_id, action, entity, detail)
   VALUES ($1, 'seed', 'system', 'Demonstration dataset loaded')`, [recordsOfficer]);

await client.end();
console.log('Seed complete.');
