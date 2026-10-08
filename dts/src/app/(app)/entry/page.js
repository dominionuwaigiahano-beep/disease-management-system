'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const fmt = (n) => Number(n ?? 0).toLocaleString('en-NG');
const key = (d, a, s) => `${d}:${a}:${s}`;

export default function Entry() {
  const [reference, setReference] = useState(null);
  const [departmentId, setDepartmentId] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [cells, setCells] = useState({});
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/reference').then(r => r.json()).then(d => {
      setReference(d);
      if (d.departments?.length) setDepartmentId(String(d.departments[0].id));
      if (d.periods?.length) {
        setYear(String(d.periods[0].year));
        setMonth(String(d.periods[0].month));
      }
    });
  }, []);

  const load = useCallback(() => {
    if (!departmentId || !year || !month) return;
    fetch(`/api/returns?department=${departmentId}&year=${year}&month=${month}`)
      .then(r => r.json())
      .then(d => {
        const next = {};
        for (const c of d.cells ?? []) next[key(c.disease_id, c.age_group_id, c.sex)] = c.case_count;
        setCells(next);
        setStatus(d.status);
        setMessage(null);
      });
  }, [departmentId, year, month]);

  useEffect(() => { load(); }, [load]);

  function setCell(d, a, s, value) {
    const clean = value === '' ? '' : Math.max(0, Math.floor(Number(value) || 0));
    setCells(prev => ({ ...prev, [key(d, a, s)]: clean }));
  }

  const rowTotals = useMemo(() => {
    const out = {};
    if (!reference) return out;
    for (const d of reference.diseases) {
      let sum = 0;
      for (const a of reference.ageGroups) {
        for (const s of ['M', 'F']) sum += Number(cells[key(d.id, a.id, s)] || 0);
      }
      out[d.id] = sum;
    }
    return out;
  }, [cells, reference]);

  const grandTotal = Object.values(rowTotals).reduce((a, b) => a + b, 0);

  async function save(submit) {
    if (!reference) return;
    setBusy(true); setMessage(null);

    const payload = [];
    for (const d of reference.diseases) {
      for (const a of reference.ageGroups) {
        for (const s of ['M', 'F']) {
          payload.push({
            diseaseId: d.id, ageGroupId: a.id, sex: s,
            count: Number(cells[key(d.id, a.id, s)] || 0),
          });
        }
      }
    }

    const res = await fetch('/api/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        departmentId: Number(departmentId), year: Number(year), month: Number(month),
        cells: payload, submit,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) { setMessage({ kind: 'error', text: d.error || 'The return could not be saved.' }); return; }
    setMessage({
      kind: 'ok',
      text: submit
        ? `Return submitted for ${MONTHS[Number(month) - 1]} ${year}. The dashboard and trend charts now include it.`
        : `Saved. ${fmt(d.saved)} cells written.`,
    });
    load();
  }

  const years = reference
    ? [...new Set(reference.periods.map(p => p.year))].sort((a, b) => b - a) : [];
  const yearOptions = years.length ? years : [new Date().getFullYear()];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Monthly returns</h1>
        <p className="lede">
          Enter the case counts for one department and one month. The layout follows the
          paper return, so figures can be copied across row by row. Leave a cell blank where
          there were no cases; a blank is stored as zero.
        </p>
      </div>

      <div className="controls">
        <div className="field">
          <label htmlFor="dept">Department</label>
          <select id="dept" value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
            {reference?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="m">Month</label>
          <select id="m" value={month} onChange={e => setMonth(e.target.value)}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="y">Year</label>
          <select id="y" value={year} onChange={e => setYear(e.target.value)}>
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Total entered</label>
          <div className="numeral" style={{ padding: '.42rem 0', fontWeight: 600 }}>
            {fmt(grandTotal)} cases
          </div>
        </div>
      </div>

      {message && <div className={`msg ${message.kind}`} role="status">{message.text}</div>}
      {status?.status === 'submitted' && (
        <div className="msg note">
          This return was already submitted{status.submitted_by ? ` by ${status.submitted_by}` : ''}.
          Saving again will correct the figures and the change will be recorded in the audit log.
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Case counts by age group and sex</h2>
          <span className="hint">M is male, F is female</span>
        </div>
        <div className="panel-body tight entry-grid">
          {!reference ? <p className="empty">Loading the form.</p> : (
            <table>
              <thead>
                <tr>
                  <th rowSpan={2}>Disease</th>
                  {reference.ageGroups.map(a => (
                    <th key={a.id} colSpan={2} className="num">{a.label}</th>
                  ))}
                  <th rowSpan={2} className="num">Total</th>
                </tr>
                <tr>
                  {reference.ageGroups.map(a => (
                    <>
                      <th key={`${a.id}m`} className="num">M</th>
                      <th key={`${a.id}f`} className="num">F</th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reference.diseases.map(d => (
                  <tr key={d.id}>
                    <td className="disease">
                      {d.name}
                      {d.is_notifiable && <> <span className="tag notifiable">N</span></>}
                    </td>
                    {reference.ageGroups.map(a => (
                      <>
                        <td key={`${d.id}-${a.id}-M`} className="num">
                          <input type="number" min="0" max="100000"
                            aria-label={`${d.name}, ${a.label}, male`}
                            value={cells[key(d.id, a.id, 'M')] ?? ''}
                            onChange={e => setCell(d.id, a.id, 'M', e.target.value)} />
                        </td>
                        <td key={`${d.id}-${a.id}-F`} className="num">
                          <input type="number" min="0" max="100000"
                            aria-label={`${d.name}, ${a.label}, female`}
                            value={cells[key(d.id, a.id, 'F')] ?? ''}
                            onChange={e => setCell(d.id, a.id, 'F', e.target.value)} />
                        </td>
                      </>
                    ))}
                    <td className="num numeral"><strong>{fmt(rowTotals[d.id])}</strong></td>
                  </tr>
                ))}
                <tr className="total">
                  <td>All diseases</td>
                  <td colSpan={reference.ageGroups.length * 2}></td>
                  <td className="num numeral">{fmt(grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div style={{ display: 'flex', gap: '.6rem' }}>
        <button className="btn quiet" onClick={() => save(false)} disabled={busy}>
          {busy ? 'Working' : 'Save draft'}
        </button>
        <button className="btn" onClick={() => save(true)} disabled={busy}>
          {busy ? 'Working' : 'Submit return'}
        </button>
      </div>
    </div>
  );
}
