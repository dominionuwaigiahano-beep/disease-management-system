import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';

export async function GET() {
  try {
    await requireUser('viewer');
    const [diseases, departments, ageGroups, periods] = await Promise.all([
      query(`SELECT id, name, code, category, is_notifiable FROM diseases
              WHERE is_active ORDER BY name`),
      query(`SELECT id, name, code FROM departments WHERE is_active ORDER BY name`),
      query(`SELECT id, label FROM age_groups ORDER BY sort_order`),
      query(`SELECT id, year, month FROM periods ORDER BY ordinal DESC`),
    ]);
    return NextResponse.json({ diseases, departments, ageGroups, periods });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
