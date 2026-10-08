import pg from 'pg';

// A single pool is shared across requests. On Vercel each serverless
// instance keeps its own, so the pool is deliberately small and the
// Supabase transaction pooler is used in production.
const globalForPg = globalThis;

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  return new pg.Pool({
    connectionString,
    max: connectionString.includes('supabase') ? 3 : 10,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
    ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : false,
  });
}

export const pool = globalForPg.__dtsPool ?? (globalForPg.__dtsPool = createPool());

/** Parameterised query. Values never reach the SQL string, which is what
 *  closes off the injection class of vulnerability (section 2.2.12). */
export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}

export async function one(text, params = []) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}
