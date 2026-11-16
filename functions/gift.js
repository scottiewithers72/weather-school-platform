// GET /api/gift?g=<token>&k=<view_key>  -> data for the printable certificate.
import { sql } from './lib/db.js';
import { handle, ok, bad } from './lib/http.js';

export const handler = handle(async (event) => {
  const { g, k } = event.queryStringParameters || {};
  if (!g || !k) return bad('Missing gift link', 404);
  const db = sql();
  const [row] = await db`
    SELECT gi.*, c.title, c.grade_band, c.school_id, c.cohort_start, c.hero_image
    FROM gifts gi JOIN classes c ON c.id = gi.class_id
    WHERE gi.token=${g} AND gi.view_key=${k}`;
  if (!row) return bad('Gift not found', 404);
  if (row.status === 'pending') return bad('This gift is still being processed — check back in a minute', 409);
  return ok({
    schoolId: row.school_id, className: row.title, gradeBand: row.grade_band,
    cohortStart: row.cohort_start, fromName: row.from_name, recipientName: row.recipient_name,
    message: row.message, code: row.code, deliverOn: row.deliver_on, status: row.status
  });
});
