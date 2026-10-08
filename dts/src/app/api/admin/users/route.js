import { NextResponse } from 'next/server';
import { query, one } from '@/lib/db';
import { requireUser, AuthError, hashPassword } from '@/lib/auth';
import { audit } from '@/lib/audit';

export async function GET() {
  try {
    await requireUser('administrator');
    const users = await query(
      `SELECT id, full_name, email, role, is_active, last_login_at, created_at
         FROM users ORDER BY full_name`);
    const activity = await query(
      `SELECT a.id, a.action, a.entity, a.detail, a.created_at, u.full_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC LIMIT 40`);
    return NextResponse.json({ users, activity });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

export async function POST(request) {
  try {
    const admin = await requireUser('administrator');
    const { fullName, email, password, role } = await request.json().catch(() => ({}));

    if (!fullName?.trim() || !email?.trim() || !password || !role) {
      return NextResponse.json({ error: 'Every field is required.' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Use a password of at least 8 characters.' }, { status: 400 });
    }
    if (!['administrator', 'records_officer', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Choose a valid role.' }, { status: 400 });
    }
    const clean = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      return NextResponse.json({ error: 'That email address is not valid.' }, { status: 400 });
    }
    if (await one(`SELECT id FROM users WHERE email=$1`, [clean])) {
      return NextResponse.json({ error: 'An account already uses that email.' }, { status: 409 });
    }

    const created = await one(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [fullName.trim(), clean, await hashPassword(password), role]);

    await audit(admin.id, 'create_user', 'users', created.id, `${clean} as ${role}`);
    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'The account could not be created.' }, { status: 500 });
  }
}
