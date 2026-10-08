// Applies the SQL files in db/ in order. Works against local PostgreSQL
// and against Supabase without modification -- only DATABASE_URL changes.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes('supabase') ? { rejectUnauthorized: false } : false,
});

await client.connect();
const files = readdirSync(join(root, 'db')).filter(f => f.endsWith('.sql')).sort();
for (const f of files) {
  process.stdout.write(`  applying ${f} ... `);
  await client.query(readFileSync(join(root, 'db', f), 'utf8'));
  console.log('ok');
}
await client.end();
console.log('Migration complete.');
