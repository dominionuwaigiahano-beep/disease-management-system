import { NextResponse } from 'next/server';
import { query, one } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Every response here comes out of the views and functions defined in
 * db/002_analysis.sql. This handler chooses a query and shapes the
 * result for the chart that will display it; it does no arithmetic of
 * its own.
 */
export async function GET(request) {
  try {
    await requireUser('viewer');
    const params = request.nextUrl.searchParams;
    const view = params.get('view') ?? 'summary';
    const diseaseId = params.get('disease') ? Number(params.get('disease')) : null;
    const year = params.get('year') ? Number(params.get('year')) : null;

    switch (view) {

      // ---- headline figures for the dashboard -----------------------
      case 'summary': {
        const latest = await one(
          `SELECT id, year, month FROM periods ORDER BY ordinal DESC LIMIT 1`);
        if (!latest) return NextResponse.json({ latest: null });

        const totals = await one(
          `SELECT COALESCE(SUM(total_cases),0)::INTEGER AS total,
                  COUNT(DISTINCT disease_id)::INTEGER   AS diseases
             FROM vw_monthly_totals WHERE period_id = $1`, [latest.id]);

        const prevYear = await one(
          `SELECT COALESCE(SUM(v.total_cases),0)::INTEGER AS total
             FROM vw_monthly_totals v JOIN periods p ON p.id = v.period_id
            WHERE p.year = $1 AND p.month = $2`, [latest.year - 1, latest.month]);

        const openAlerts = await one(
          `SELECT COUNT(*)::INTEGER AS n FROM alerts WHERE status = 'open'`);

        const completeness = await one(
          `SELECT submitted, expected, completeness_pct
             FROM vw_reporting_completeness WHERE period_id = $1`, [latest.id]);

        return NextResponse.json({
          latest: { ...latest, label: `${MONTHS[latest.month - 1]} ${latest.year}` },
          totalCases: totals.total,
          diseasesReported: totals.diseases,
          samePeriodLastYear: prevYear?.total ?? 0,
          openAlerts: openAlerts.n,
          completeness,
        });
      }

      // ---- monthly trend line ---------------------------------------
      case 'trend': {
        const rows = await query(
          `SELECT year, month, SUM(total_cases)::INTEGER AS cases
             FROM vw_monthly_totals
            WHERE ($1::INTEGER IS NULL OR disease_id = $1)
            GROUP BY year, month, (year*12+month)
            ORDER BY (year*12+month)`, [diseaseId]);
        return NextResponse.json({
          series: rows.map(r => ({
            label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`,
            year: r.year, month: r.month, cases: r.cases,
          })),
        });
      }

      // ---- ranked disease burden ------------------------------------
      case 'burden': {
        const rows = await query(
          `SELECT disease_name, category, is_notifiable,
                  SUM(total_cases)::INTEGER AS cases
             FROM vw_disease_burden
            WHERE ($1::INTEGER IS NULL OR year = $1)
            GROUP BY disease_name, category, is_notifiable
            ORDER BY cases DESC`, [year]);
        return NextResponse.json({ rows });
      }

      // ---- age and sex breakdown ------------------------------------
      case 'demographics': {
        const rows = await query(
          `SELECT age_group, sort_order, sex, SUM(total_cases)::INTEGER AS cases
             FROM vw_demographics
            WHERE ($1::INTEGER IS NULL OR disease_id = $1)
              AND ($2::INTEGER IS NULL OR year = $2)
            GROUP BY age_group, sort_order, sex
            ORDER BY sort_order`, [diseaseId, year]);

        const byAge = new Map();
        for (const r of rows) {
          const entry = byAge.get(r.age_group) ?? { age_group: r.age_group, Male: 0, Female: 0 };
          entry[r.sex === 'M' ? 'Male' : 'Female'] = r.cases;
          byAge.set(r.age_group, entry);
        }
        return NextResponse.json({ rows: [...byAge.values()] });
      }

      // ---- seasonal profile -----------------------------------------
      case 'seasonal': {
        if (!diseaseId) {
          return NextResponse.json({ error: 'Choose a disease first.' }, { status: 400 });
        }
        const rows = await query(
          `SELECT month, mean_cases, sd_cases, min_cases, max_cases, years_contributing
             FROM vw_seasonal_profile WHERE disease_id = $1 ORDER BY month`, [diseaseId]);
        return NextResponse.json({
          rows: rows.map(r => ({
            month: MONTHS[r.month - 1],
            mean: Number(r.mean_cases),
            min: r.min_cases,
            max: r.max_cases,
            years: r.years_contributing,
          })),
          yearsMin: rows.length ? Math.min(...rows.map(r => r.years_contributing)) : 0,
          yearsMax: rows.length ? Math.max(...rows.map(r => r.years_contributing)) : 0,
        });
      }

      // ---- same month, this year against last -----------------------
      case 'yearonyear': {
        const rows = await query(
          `SELECT month, year, SUM(total_cases)::INTEGER AS cases
             FROM vw_monthly_totals
            WHERE ($1::INTEGER IS NULL OR disease_id = $1)
            GROUP BY month, year ORDER BY month, year`, [diseaseId]);

        const years = [...new Set(rows.map(r => r.year))].sort().slice(-2);
        const shaped = MONTHS.map((label, i) => {
          const point = { month: label };
          for (const y of years) {
            point[String(y)] = rows.find(r => r.month === i + 1 && r.year === y)?.cases ?? null;
          }
          return point;
        });
        return NextResponse.json({ rows: shaped, years: years.map(String) });
      }

      // ---- caseload by reporting department -------------------------
      case 'departments': {
        const rows = await query(
          `SELECT department_name, SUM(total_cases)::INTEGER AS cases
             FROM vw_department_load
            WHERE ($1::INTEGER IS NULL OR year = $1)
            GROUP BY department_name ORDER BY cases DESC`, [year]);
        return NextResponse.json({ rows });
      }

      default:
        return NextResponse.json({ error: `Unknown view "${view}".` }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'The analysis could not be produced.' }, { status: 500 });
  }
}
