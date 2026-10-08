'use client';
import { useEffect, useState } from 'react';
import {
  TrendChart, SeasonalChart, DemographicsChart, YearOnYearChart,
} from '@/components/Charts';

const fmt = (n) => Number(n ?? 0).toLocaleString('en-NG');

export default function Analysis() {
  const [reference, setReference] = useState(null);
  const [diseaseId, setDiseaseId] = useState('');
  const [year, setYear] = useState('');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/reference')
      .then(r => r.json())
      .then(d => {
        setReference(d);
        const years = [...new Set((d.periods ?? []).map(p => p.year))].sort((a, b) => b - a);
        setYear(String(years[0] ?? ''));
      })
      .catch(() => setError('The reference data could not be loaded.'));
  }, []);

  useEffect(() => {
    if (!reference) return;
    setLoading(true); setError('');

    const q = (view, extra = '') =>
      fetch(`/api/analysis?view=${view}${diseaseId ? `&disease=${diseaseId}` : ''}${extra}`)
        .then(r => r.json());

    Promise.all([
      q('trend'),
      q('demographics', year ? `&year=${year}` : ''),
      q('yearonyear'),
      diseaseId ? q('seasonal') : Promise.resolve({ rows: [] }),
    ])
      .then(([trend, demo, yoy, seasonal]) => {
        setData({ trend, demo, yoy, seasonal });
        setLoading(false);
      })
      .catch(() => { setError('The analysis could not be produced.'); setLoading(false); });
  }, [reference, diseaseId, year]);

  const years = reference
    ? [...new Set(reference.periods.map(p => p.year))].sort((a, b) => b - a) : [];
  const diseaseName = reference?.diseases.find(d => String(d.id) === diseaseId)?.name;
  const scope = diseaseName ?? 'all diseases';

  const totalCases = (data.trend?.series ?? []).reduce((s, r) => s + r.cases, 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Trend analysis</h1>
        <p className="lede">
          Compare a disease against its own history. Month against month shows short term
          movement, the same month across years removes the seasonal effect, and the
          seasonal profile shows the shape of a typical year.
        </p>
      </div>

      <div className="controls">
        <div className="field">
          <label htmlFor="disease">Disease</label>
          <select id="disease" value={diseaseId} onChange={e => setDiseaseId(e.target.value)}>
            <option value="">All diseases</option>
            {reference?.diseases.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="year">Year for the age and sex breakdown</label>
          <select id="year" value={year} onChange={e => setYear(e.target.value)}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Total in view</label>
          <div className="numeral" style={{ padding: '.42rem 0', fontWeight: 600 }}>
            {fmt(totalCases)} cases
          </div>
        </div>
      </div>

      {error && <div className="msg error" role="alert">{error}</div>}
      {loading && <div className="msg ok">Loading the analysis.</div>}

      <section className="panel">
        <div className="panel-head">
          <h2>Monthly trend, {scope}</h2>
          <span className="hint">Every month held in the system</span>
        </div>
        <div className="panel-body tight">
          <TrendChart data={data.trend?.series ?? []} height={280} />
        </div>
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="panel-head">
            <h2>Same month, year against year</h2>
            <span className="hint">Removes the seasonal effect</span>
          </div>
          <div className="panel-body tight">
            <YearOnYearChart data={data.yoy?.rows ?? []} years={data.yoy?.years ?? []} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Seasonal profile</h2>
            <span className="hint">
              {data.seasonal?.yearsMin
                ? (data.seasonal.yearsMin === data.seasonal.yearsMax
                    ? `Averaged over ${data.seasonal.yearsMin} years`
                    : `Averaged over ${data.seasonal.yearsMin} to ${data.seasonal.yearsMax} years`)
                : 'Select a disease'}
            </span>
          </div>
          <div className="panel-body tight">
            <SeasonalChart data={data.seasonal?.rows ?? []} />
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Age group and sex, {scope} in {year}</h2>
          <span className="hint">A steady total can hide movement inside it</span>
        </div>
        <div className="panel-body tight">
          <DemographicsChart data={data.demo?.rows ?? []} />
        </div>
      </section>

      {data.seasonal?.rows?.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Seasonal profile in figures</h2></div>
          <div className="panel-body" style={{ padding: '.25rem 0 0' }}>
            <table>
              <thead>
                <tr>
                  <th>Month</th><th className="num">Average</th>
                  <th className="num">Lowest</th><th className="num">Highest</th>
                  <th className="num">Years</th>
                </tr>
              </thead>
              <tbody>
                {data.seasonal.rows.map(r => (
                  <tr key={r.month}>
                    <td>{r.month}</td>
                    <td className="num">{fmt(r.mean)}</td>
                    <td className="num">{fmt(r.min)}</td>
                    <td className="num">{fmt(r.max)}</td>
                    <td className="num">{r.years}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
