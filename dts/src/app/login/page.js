'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Sign in failed.'); setBusy(false); return; }
    router.replace('/');
    router.refresh();
  }

  function useDemo(e, pw) { setEmail(e); setPassword(pw); setError(''); }

  return (
    <main className="signin">
      <form className="signin-card" onSubmit={submit}>
        <h1>Disease Trend Analysis</h1>
        <p className="sub">University of Benin Teaching Hospital, Benin City</p>

        {error && <div className="msg error" role="alert">{error}</div>}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} autoComplete="username"
                 onChange={e => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" value={password} autoComplete="current-password"
                 onChange={e => setPassword(e.target.value)} required />
        </div>

        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Signing in' : 'Sign in'}
        </button>

        <div className="signin-demo">
          <p style={{ marginBottom: '.5rem' }}>Demonstration accounts</p>
          <p style={{ margin: 0 }}>
            <button type="button" onClick={() => useDemo('admin@ubth.edu.ng', 'Admin@2026')}>
              Administrator</button> <code>admin@ubth.edu.ng</code>
          </p>
          <p style={{ margin: 0 }}>
            <button type="button" onClick={() => useDemo('records@ubth.edu.ng', 'Records@2026')}>
              Records officer</button> <code>records@ubth.edu.ng</code>
          </p>
          <p style={{ margin: 0 }}>
            <button type="button" onClick={() => useDemo('viewer@ubth.edu.ng', 'Viewer@2026')}>
              Medical officer</button> <code>viewer@ubth.edu.ng</code>
          </p>
        </div>
      </form>
    </main>
  );
}
