import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { one } from '@/lib/db';
import Rail from '@/components/Rail';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }) {
  const user = await currentUser();
  if (!user) redirect('/login');

  let openAlerts = 0;
  try {
    const row = await one(`SELECT COUNT(*)::INTEGER AS n FROM alerts WHERE status='open'`);
    openAlerts = row?.n ?? 0;
  } catch { openAlerts = 0; }

  return (
    <div className="shell">
      <Rail user={user} openAlerts={openAlerts} />
      <div className="main">{children}</div>
    </div>
  );
}
