'use client';
import { useCallback, useEffect, useState } from 'react';

const fmt = (n) => Number(n ?? 0).toLocaleString('en-NG');

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState('open');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/alerts${filter ? `?status=${filter}` : ''}`)
      .then(r => r.json())
      .then(d => { setAlerts(d.alerts ?? []); setLoading(false); })
      .catch(() => { setMessage({ kind: 'error', text: 'The signals could not be loaded.' }); setLoading(false); });
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch('/api/auth/me').then(r => r.json()).then(d => setMe(d.user)); }, []);

  const canReview = me && me.role !== 'viewer';

  async function review(id, status) {
    const res = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'review', alertId: id, status }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setMessage({ kind: 'error', text: d.error || 'That could not be saved.' }); return; }
    setMessage({ kind: 'ok', text: `Signal marked as ${status}.` });
    load();
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Signals</h1>
        <p className="lede">
          A signal is raised when a monthly count rises above what the same month produced
          in previous years. It means the figure is worth a closer look. It does not mean an
          outbreak has been confirmed, and a rise may equally reflect a change in referral,
          diagnosis or recording.
        </p>
      </div>

      {message && (
        <div className={`msg ${message.kind}`} role="status">{message.text}</div>
      )}

      <div className="controls">
        <div className="field">
          <label htmlFor="filter">Showing</label>
          <select id="filter" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="open">Open</option>
            <option value="investigating">Under investigation</option>
            <option value="closed">Closed</option>
            <option value="">All</option>
          </select>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{loading ? 'Loading' : `${alerts.length} signal${alerts.length === 1 ? '' : 's'}`}</h2>
          <span className="hint">Most recent month first</span>
        </div>
        <div className="panel-body" style={{ padding: '.25rem 0 0' }}>
          {!loading && alerts.length === 0 ? (
            <p className="empty">Nothing to show for this filter.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Disease</th>
                  <th className="num">Observed</th>
                  <th className="num">Expected</th>
                  <th className="num">Threshold</th>
                  <th className="num">Rise</th>
                  <th>Confidence</th>
                  <th>Status</th>
                  {canReview && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {alerts.map(a => (
                  <tr key={a.id}>
                    <td>{a.period}</td>
                    <td>
                      {a.disease}
                      {a.is_notifiable && <> <span className="tag notifiable">Notifiable</span></>}
                    </td>
                    <td className="num"><strong>{fmt(a.observed)}</strong></td>
                    <td className="num">{fmt(Math.round(a.baseline_mean))}</td>
                    <td className="num">{fmt(Math.round(a.threshold))}</td>
                    <td className="num">{a.excessPct === null ? '--' : `+${a.excessPct}%`}</td>
                    <td>
                      <span className={`tag ${a.confidence}`}>{a.confidence}</span>
                      <span style={{ color: 'var(--muted)', fontSize: '.78rem' }}>
                        {' '}{a.years_in_baseline} yr
                      </span>
                    </td>
                    <td><span className={`tag ${a.status}`}>{a.status}</span></td>
                    {canReview && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {a.status !== 'investigating' && (
                          <button className="btn quiet" style={{ padding: '.2rem .5rem', minHeight: 0, fontSize: '.8rem' }}
                                  onClick={() => review(a.id, 'investigating')}>Investigate</button>
                        )}{' '}
                        {a.status !== 'closed' && (
                          <button className="btn quiet" style={{ padding: '.2rem .5rem', minHeight: 0, fontSize: '.8rem' }}
                                  onClick={() => review(a.id, 'closed')}>Close</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>How the threshold is calculated</h2></div>
        <div className="panel-body">
          <p>
            For a disease in a given month, the system takes the counts recorded in that same
            calendar month in every previous year and computes their average and spread. The
            threshold is the average plus two standard deviations. A count above the threshold
            raises a signal.
          </p>
          <p>
            The comparison uses the same month in earlier years rather than the months
            immediately before, because most conditions here are seasonal. Comparing July with
            June would flag every malaria season as an outbreak.
          </p>
          <p style={{ marginBottom: 0 }}>
            Confidence reports how much history the threshold rests on. Three or more previous
            years is marked high, two is marked moderate, and with fewer than two years no
            threshold is computed at all rather than presenting a figure that cannot bear weight.
          </p>
        </div>
      </section>
    </div>
  );
}
