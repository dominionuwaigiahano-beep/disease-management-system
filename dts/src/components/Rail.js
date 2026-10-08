'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const ROLE_LABEL = {
  administrator: 'Administrator',
  records_officer: 'Records officer',
  viewer: 'Medical officer',
};

export default function Rail({ user, openAlerts }) {
  const path = usePathname();
  const router = useRouter();

  const links = [
    { href: '/',          label: 'Dashboard' },
    { href: '/analysis',  label: 'Trend analysis' },
    { href: '/alerts',    label: 'Signals', tally: openAlerts },
    ...(user.role !== 'viewer' ? [{ href: '/entry', label: 'Monthly returns' }] : []),
    ...(user.role === 'administrator' ? [{ href: '/admin', label: 'Administration' }] : []),
  ];

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <nav className="rail" aria-label="Main">
      <div className="rail-brand">
        <strong>Disease Trends</strong>
        <span>University of Benin Teaching Hospital</span>
      </div>

      <div className="rail-nav">
        {links.map(l => (
          <Link key={l.href} href={l.href} aria-current={path === l.href ? 'page' : undefined}>
            {l.label}
            {l.tally > 0 && <span className="tally">{l.tally}</span>}
          </Link>
        ))}
      </div>

      <div className="rail-foot">
        <div className="who">{user.name}</div>
        <div className="role">{ROLE_LABEL[user.role]}</div>
        <button type="button" onClick={signOut}>Sign out</button>
      </div>
    </nav>
  );
}
