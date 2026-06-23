// Shared database client (Neon serverless Postgres).
// Both Netlify sites point DATABASE_URL at the SAME database.
import { neon } from '@neondatabase/serverless';

let _sql = null;
export function sql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}
