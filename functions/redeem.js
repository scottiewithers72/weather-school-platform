// POST /api/redeem { code }
// Single-use access code -> family enrollment. Code dies at redemption.
import { sql } from './lib/db.js';
import { requireFamily } from './lib/auth.js';
import { handle, ok, bad, parseBody } from './lib/http.js';
import { licenseExpiry } from './lib/core.js';

export const handler = handle(async (event) => {
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const session = requireFamily(event);
  const db = sql();
  const code = (parseBody(event).code || '').trim().toUpperCase();
  if (!code) return bad('Enter your access code');

  // Atomic claim: only succeeds if not already redeemed.
  const claimed = await db`
    UPDATE access_codes SET redeemed_by=${session.familyId}, redeemed_at=now()
    WHERE code=${code} AND redeemed_at IS NULL
    RETURNING class_id`;
  if (!claimed.length) {
    const [existing] = await db`SELECT redeemed_by FROM access_codes WHERE code=${code}`;
    if (!existing) return bad('That code was not found — check for typos');
    if (existing.redeemed_by === session.familyId) return bad('Your family already redeemed this code');
    return bad('This code has already been used');
  }

  const classId = claimed[0].class_id;
  const [cls] = await db`SELECT * FROM classes WHERE id=${classId}`;

  // Cohort classes drip from the class's cohort_start (school calendar date);
  // evergreen classes unlock everything immediately.
  const releaseMode = cls.status === 'evergreen' ? 'all_now' : 'drip';
  const dripStart = cls.cohort_start
    ? new Date(cls.cohort_start).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  await db`
    INSERT INTO enrollments (family_id, class_id, source, release_mode, drip_start, expires_at)
    VALUES (${session.familyId}, ${classId}, 'code', ${releaseMode}, ${dripStart}, ${licenseExpiry()})
    ON CONFLICT (family_id, class_id) DO NOTHING`;

  return ok({ classId, title: cls.title, releaseMode });
});
