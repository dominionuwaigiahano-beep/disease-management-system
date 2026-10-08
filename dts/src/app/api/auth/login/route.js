import { NextResponse } from 'next/server';
import { one, query } from '@/lib/db';
import { verifyPassword, issueSession } from '@/lib/auth';
import { audit } from '@/lib/audit';

export async function POST(request) {
  const { email, password } = await request.json().catch(() => ({}));

  // Server-side validation. Anything the browser checked is advisory only.
  if (typeof email !== 'string' || typeof password !== 'string' ||
      !email.trim() || !password) {
    return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
  }

  const user = await one(
    `SELECT id, full_name, email, password_hash, role, is_active
       FROM users WHERE email = $1`, [email.trim().toLowerCase()]);

  // Same message whether the account is missing or the password is wrong,
  // so the form cannot be used to discover which emails exist.
  const ok = user && user.is_active && await verifyPassword(password, user.password_hash);
  if (!ok) {
    await audit(user?.id ?? null, 'login_failed', 'users', user?.id, email);
    return NextResponse.json({ error: 'Those details do not match an account.' }, { status: 401 });
  }

  await issueSession(user);
  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
  await audit(user.id, 'login', 'users', user.id);

  return NextResponse.json({
    user: { id: user.id, name: user.full_name, role: user.role },
  });
}
