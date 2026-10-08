'use client';
import { useCallback, useEffect, useState } from 'react';

const ROLE_LABEL = {
  administrator: 'Administrator',
  records_officer: 'Records officer',
  viewer: 'Medical officer',
};

export default function Admin() {
  const [data, setData] = useState({ users: [], activity: [] });
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'viewer' });
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/admin/users').then(r => r.json()).then(d => {
      if (d.error) { setMessage({ kind: 'error', text: d.error }); return; }
      setData(d);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createUser(e) {
    e.preventDefault();
    setBusy(true); setMessage(null);
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMessage({ kind: 'error', text: d.error }); return; }
    setMessage({ kind: 'ok', text: `Account created for ${form.email}.` });
    setForm({ fullName: '', email: '', password: '', role: 'viewer' });
    load();
  }

  const when = (t) => t ? new Date(t).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : 'never';

  return (
    <div className="page">
      <div className="page-head">
        <h1>Administration</h1>
        <p className="lede">
          Accounts and the record of activity. A records officer may enter and correct
          returns, a medical officer may read the dashboards only, and an administrator may
          do both and manage accounts.
        </p>
      </div>

      {message && <div className={`msg ${message.kind}`} role="status">{message.text}</div>}

      <div className="grid2">
        <section className="panel">
          <div className="panel-head"><h2>Accounts</h2></div>
          <div className="panel-body" style={{ padding: '.25rem 0 0' }}>
            <table>
              <thead>
                <tr><th>Name</th><th>Role</th><th>Last signed in</th></tr>
              </thead>
              <tbody>
                {data.users.map(u => (
                  <tr key={u.id}>
                    <td>
                      {u.full_name}
                      <div style={{ color: 'var(--muted)', fontSize: '.8rem' }}>{u.email}</div>
                    </td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td style={{ fontSize: '.85rem' }}>{when(u.last_login_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Add an account</h2></div>
          <div className="panel-body">
            <form onSubmit={createUser}>
              <div className="field" style={{ marginBottom: '.7rem' }}>
                <label htmlFor="fn">Full name</label>
                <input id="fn" type="text" required value={form.fullName}
                  onChange={e => setForm({ ...form, fullName: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: '.7rem' }}>
                <label htmlFor="em">Email</label>
                <input id="em" type="email" required value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: '.7rem' }}>
                <label htmlFor="pw">Password, at least 8 characters</label>
                <input id="pw" type="password" required minLength={8} value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: '1rem' }}>
                <label htmlFor="rl">Role</label>
                <select id="rl" value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}>
                  <option value="viewer">Medical officer, read only</option>
                  <option value="records_officer">Records officer</option>
                  <option value="administrator">Administrator</option>
                </select>
              </div>
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Working' : 'Create account'}
              </button>
            </form>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Activity record</h2>
          <span className="hint">Most recent 40 entries</span>
        </div>
        <div className="panel-body" style={{ padding: '.25rem 0 0' }}>
          <table>
            <thead>
              <tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {data.activity.map(a => (
                <tr key={a.id}>
                  <td style={{ fontSize: '.85rem', whiteSpace: 'nowrap' }}>{when(a.created_at)}</td>
                  <td>{a.full_name ?? 'system'}</td>
                  <td>{a.action.replace(/_/g, ' ')}</td>
                  <td style={{ color: 'var(--muted)', fontSize: '.85rem' }}>{a.detail ?? a.entity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
