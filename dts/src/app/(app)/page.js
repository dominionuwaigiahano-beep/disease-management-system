import Link from 'next/link';
import { query, one } from '@/lib/db';
import { TrendChart, BurdenChart } from '@/components/Charts';

export const dynamic = 'force-dynamic';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmt = (n) => Number(n ?? 0).toLocaleString('en-NG');

export default async function Dashboard() {
  const latest = await one(`SELECT id, year, month FROM periods ORDER BY ordinal DESC LIMIT 1`);

  if (!latest) {
    return (
      <div className="page">
        <div className="page-head"><h1>Dashboard</h1></div>
        <div className="panel"><div className="panel-body">
          <p>No returns have been entered yet.</p>
          <Link className="btn" href="/entry">Enter the first monthly return</Link>
        </div></div>
      </div>
    );
  }

  const periodLabel = `${MONTHS[latest.month - 1]} ${latest.year}`;

  const [totals, lastYear, completeness, openAlerts, trend, burden, departments] =
    await Promise.all([
      one(`SELECT COALESCE(SUM(total_cases),0)::INTEGER AS total,
                  COUNT(DISTINCT disease_id)::INTEGER   AS diseases
             FROM vw_monthly_totals WHERE period_id = $1`, [latest.id]),
      one(`SELECT COALESCE(SUM(v.total_cases),0)::INTEGER AS total
             FROM vw_monthly_totals v JOIN periods p ON p.id = v.period_id
            WHERE p.year = $1 AND p.month = $2`, [latest.year - 1, latest.month]),
      one(`SELECT submitted, expected, completeness_pct
             FROM vw_reporting_completeness WHERE period_id = $1`, [latest.id]),
      query(`SELECT a.id, d.name AS disease, d.is_notifiable, a.observed,
                    a.baseline_mean, a.threshold, a.confidence
               FROM alerts a JOIN diseases d ON d.id = a.disease_id
              WHERE a.period_id = $1 AND a.status = 'open'
              ORDER BY (a.observed - a.baseline_mean) DESC`, [latest.id]),
      query(`SELECT year, month, SUM(total_cases)::INTEGER AS cases
               FROM vw_monthly_totals GROUP BY year, month, (year*12+month)
              ORDER BY (year*12+month)`),
      query(`SELECT disease_name, is_notifiable, SUM(total_cases)::INTEGER AS cases
               FROM vw_disease_burden WHERE year = $1
              GROUP BY disease_name, is_notifiable ORDER BY cases DESC LIMIT 10`, [latest.year]),
      query(`SELECT department_name, SUM(total_cases)::INTEGER AS cases
               FROM vw_department_load WHERE year = $1
              GROUP BY department_name ORDER BY cases DESC`, [latest.year]),
    ]);

  const change = lastYear.total > 0
    ? Math.round(((totals.total - lastYear.total) / lastYear.total) * 100) : null;

  const trendData = trend.map(r => ({
    label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`, cases: r.cases,
  }));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        <p className="lede">
          Reporting month {periodLabel}. Figures cover every department that has
          submitted a return for the month.
        </p>
      </div>

      {/* The signal comes first. In a surveillance tool the question that
          matters most is whether anything is unusual right now. */}
      <section className={`strip ${openAlerts.length ? 'flagged' : ''}`}>
        {openAlerts.length ? (
          <>
            <h2>
              {openAlerts.length} disease{openAlerts.length > 1 ? 's are' : ' is'} above
              its expected level for {periodLabel}
            </h2>
            <p className="note">
              Each count below exceeded the average for the same month in previous years by
              more than the alert threshold. This is a prompt to investigate, not a finding
              of an outbreak.
            </p>
            <ul className="strip-list">
              {openAlerts.map(a => (
                <li key={a.id}>
                  <span className="nm">
                    {a.disease}
                    {a.is_notifiable && <> <span className="tag notifiable">Notifiable</span></>}
                  </span>
                  <span className="fig numeral">
                    {fmt(a.observed)} cases against an expected {fmt(Math.round(a.baseline_mean))},
                    threshold {fmt(Math.round(a.threshold))}
                  </span>
                </li>
              ))}
            </ul>
            <p style={{ marginTop: '.85rem', marginBottom: 0 }}>
              <Link href="/alerts">Review these signals</Link>
            </p>
          </>
        ) : (
          <>
            <h2>Nothing above threshold for {periodLabel}</h2>
            <p className="note" style={{ marginBottom: 0 }}>
              Every disease reported this month sits within its expected range, measured
              against the same month in previous years.
            </p>
          </>
        )}
      </section>

      <section className="figures">
        <div className="figure">
          <div className="k">Cases reported</div>
          <div className="v numeral">{fmt(totals.total)}</div>
          <div className="sub">in {periodLabel}</div>
        </div>
        <div className="figure">
          <div className="k">Against {periodLabel.replace(String(latest.year), String(latest.year - 1))}</div>
          <div className="v numeral">{change === null ? '--' : `${change > 0 ? '+' : ''}${change}%`}</div>
          <div className={`sub ${change > 0 ? 'up' : change < 0 ? 'down' : ''}`}>
            {lastYear.total > 0 ? `from ${fmt(lastYear.total)} cases` : 'no comparison available'}
          </div>
        </div>
        <div className="figure">
          <div className="k">Diseases reported</div>
          <div className="v numeral">{fmt(totals.diseases)}</div>
          <div className="sub">of the conditions on the list</div>
        </div>
        <div className="figure">
          <div className="k">Returns received</div>
          <div className="v numeral">{completeness?.submitted ?? 0}/{completeness?.expected ?? 0}</div>
          <div className="sub">
            {Number(completeness?.completeness_pct ?? 0) < 100
              ? 'some departments have not reported'
              : 'all departments have reported'}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Total reported cases by month</h2>
          <span className="hint">All diseases, {trendData.length} months of history</span>
        </div>
        <div className="panel-body tight"><TrendChart data={trendData} height={280} /></div>
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="panel-head">
            <h2>Leading causes in {latest.year}</h2>
            <span className="hint">Notifiable in red</span>
          </div>
          <div className="panel-body tight"><BurdenChart data={burden} height={320} /></div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Caseload by department, {latest.year}</h2></div>
          <div className="panel-body" style={{ padding: '.25rem 0 0' }}>
            <table>
              <thead>
                <tr><th>Department</th><th className="num">Cases</th><th className="num">Share</th></tr>
              </thead>
              <tbody>
                {departments.map(d => {
                  const total = departments.reduce((s, x) => s + x.cases, 0);
                  return (
                    <tr key={d.department_name}>
                      <td>{d.department_name}</td>
                      <td className="num">{fmt(d.cases)}</td>
                      <td className="num">{total ? Math.round((d.cases / total) * 100) : 0}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
