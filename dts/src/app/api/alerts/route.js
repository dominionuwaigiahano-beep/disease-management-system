import { NextResponse } from 'next/server';
import { query, one } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';
import { audit } from '@/lib/audit';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export async function GET(request) {
  try {
    await requireUser('viewer');
    const status = request.nextUrl.searchParams.get('status');
    const rows = await query(
      `SELECT a.id, d.name AS disease, d.is_notifiable, p.year, p.month,
              a.observed, a.baseline_mean, a.baseline_sd, a.threshold,
              a.multiplier, a.years_in_baseline, a.confidence, a.status,
              a.review_note, a.generated_at, u.full_name AS reviewed_by
         FROM alerts a
         JOIN diseases d ON d.id = a.disease_id
         JOIN periods  p ON p.id = a.period_id
    LEFT JOIN users    u ON u.id = a.reviewed_by
        WHERE ($1::TEXT IS NULL OR a.status = $1)
     ORDER BY p.ordinal DESC, a.observed DESC`, [status || null]);

    return NextResponse.json({
      alerts: rows.map(r => ({
        ...r,
        period: `${MONTHS[r.month - 1]} ${r.year}`,
        excess: Number(r.observed) - Number(r.baseline_mean),
        excessPct: Number(r.baseline_mean) > 0
          ? Math.round(((r.observed - r.baseline_mean) / r.baseline_mean) * 100) : null,
      })),
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

/** Re-run the detection rule, or record a review decision. */
export async function POST(request) {
  try {
    const user = await requireUser('records_officer');
    const { action, alertId, status, note, year, month, multiplier } =
      await request.json().catch(() => ({}));

    if (action === 'review') {
      if (!['open', 'investigating', 'closed'].includes(status)) {
        return NextResponse.json({ error: 'Choose a valid status.' }, { status: 400 });
      }
      await query(
        `UPDATE alerts SET status=$1, review_note=$2, reviewed_by=$3, reviewed_at=NOW()
          WHERE id=$4`, [status, note ?? null, user.id, alertId]);
      await audit(user.id, 'review_alert', 'alerts', alertId, status);
      return NextResponse.json({ ok: true });
    }

    if (action === 'evaluate') {
      const m = Number(multiplier) || 2.0;
      if (m < 1 || m > 5) {
        return NextResponse.json(
          { error: 'The multiplier must be between 1 and 5 standard deviations.' }, { status: 400 });
      }
      const period = await one(`SELECT id FROM periods WHERE year=$1 AND month=$2`, [year, month]);
      if (!period) return NextResponse.json({ error: 'No data for that month.' }, { status: 404 });

      const result = await one(`SELECT fn_evaluate_period($1,$2) AS flagged`, [period.id, m]);
      await audit(user.id, 'evaluate_period', 'alerts', period.id, `multiplier ${m}`);
      return NextResponse.json({ ok: true, flagged: result.flagged });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'The request could not be completed.' }, { status: 500 });
  }
}
