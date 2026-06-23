// GET /api/catalog?school=canes|earthsphere  (public — powers the websites)
import { sql } from './lib/db.js';
import { handle, ok, bad } from './lib/http.js';

export const handler = handle(async (event) => {
  const school = event.queryStringParameters?.school;
  if (!['canes', 'earthsphere'].includes(school)) return bad('school=canes|earthsphere');
  const db = sql();
  const classes = await db`
    SELECT id, title, subtitle, description, grade_band, lesson_count,
           price_cents, semester, status, hero_image, credit_value, cohort_start
    FROM classes
    WHERE school_id=${school} AND status != 'draft' AND status != 'archived'
    ORDER BY sort_order`;
  return ok({ classes });
});
