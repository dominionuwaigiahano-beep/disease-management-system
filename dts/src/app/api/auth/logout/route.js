import { NextResponse } from 'next/server';
import { clearSession, currentUser } from '@/lib/auth';
import { audit } from '@/lib/audit';

export async function POST() {
  const user = await currentUser();
  if (user) await audit(user.id, 'logout', 'users', user.id);
  clearSession();
  return NextResponse.json({ ok: true });
}
