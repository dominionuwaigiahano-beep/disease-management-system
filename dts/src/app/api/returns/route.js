import { NextResponse } from 'next/server';
import { query, one } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';
import { audit } from '@/lib/audit';

/** GET: fetch the grid for one department and month. */
export async function GET(request) {
  try {
    await requireUser('viewer');
    const p = request.nextUrl.searchParams;
    const departmentId = Number(p.get('department'));
    const year = Number(p.get('year'));
    const month = Number(p.get('month'));

    if (!departmentId || !year || !month) {
      return NextResponse.json({ error: 'Choose a department, year and month.' }, { status: 400 });
    }

    const period = await one(`SELECT id FROM periods WHERE year=$1 AND month=$2`, [year, month]);
    const cells = period ? await query(
      `SELECT disease_id, age_group_id, sex, case_count
         FROM case_counts WHERE department_id=$1 AND period_id=$2`,
      [departmentId, period.id]) : [];

    const status = period ? await one(
      `SELECT rs.status, rs.submitted_at, u.full_name AS submitted_by
         FROM return_status rs LEFT JOIN users u ON u.id = rs.submitted_by
        WHERE rs.department_id=$1 AND rs.period_id=$2`, [departmentId, period.id]) : null;

    return NextResponse.json({ cells, status: status ?? { status: 'pending' } });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

/** POST: save the grid. Records officers and administrators only. */
export async function POST(request) {
  try {
    const user = await requireUser('records_officer');
    const body = await request.json().catch(() => ({}));
    const { departmentId, year, month, cells, submit } = body;

    if (!departmentId || !year || !month || !Array.isArray(cells)) {
      return NextResponse.json({ error: 'The submission was incomplete.' }, { status: 400 });
    }
    if (month < 1 || month > 12 || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'That is not a valid reporting month.' }, { status: 400 });
    }

    // Server-side validation of every cell. The browser also checks these,
    // but a request can be made without a browser.
    for (const c of cells) {
      const n = Number(c.count);
      if (!Number.isInteger(n) || n < 0) {
        return NextResponse.json(
          { error: 'Case counts must be whole numbers of zero or more.' }, { status: 400 });
      }
      if (n > 100000) {
        return NextResponse.json(
          { error: 'A count above 100,000 is not plausible. Check the entry.' }, { status: 400 });
      }
      if (!['M', 'F'].includes(c.sex)) {
        return NextResponse.json({ error: 'Invalid sex value.' }, { status: 400 });
      }
    }

    let period = await one(`SELECT id FROM periods WHERE year=$1 AND month=$2`, [year, month]);
    if (!period) {
      period = await one(`INSERT INTO periods (year, month) VALUES ($1,$2) RETURNING id`, [year, month]);
    }

    for (const c of cells) {
      await query(
        `INSERT INTO case_counts
           (disease_id, period_id, department_id, age_group_id, sex, case_count, entered_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (disease_id, period_id, department_id, age_group_id, sex)
         DO UPDATE SET case_count = EXCLUDED.case_count, entered_by = EXCLUDED.entered_by`,
        [c.diseaseId, period.id, departmentId, c.ageGroupId, c.sex, Number(c.count), user.id]);
    }

    if (submit) {
      await query(
        `INSERT INTO return_status (department_id, period_id, status, submitted_by, submitted_at)
         VALUES ($1,$2,'submitted',$3,NOW())
         ON CONFLICT (department_id, period_id)
         DO UPDATE SET status='submitted', submitted_by=EXCLUDED.submitted_by, submitted_at=NOW()`,
        [departmentId, period.id, user.id]);
    }

    await audit(user.id, submit ? 'submit_return' : 'save_return', 'case_counts',
      `${departmentId}/${year}-${month}`, `${cells.length} cells`);

    return NextResponse.json({ ok: true, saved: cells.length, submitted: Boolean(submit) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'The return could not be saved.' }, { status: 500 });
  }
}
