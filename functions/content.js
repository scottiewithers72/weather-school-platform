// GET /api/content?lessonId=123
// Companion-app content (study guide, flash cards, quiz, game config)
// for an unlocked lesson the family is enrolled in.
import { sql } from './lib/db.js';
import { requireFamily } from './lib/auth.js';
import { handle, ok, bad } from './lib/http.js';
import { unlockedPositions } from './lib/core.js';

export const handler = handle(async (event) => {
  const session = requireFamily(event);
  const lessonId = Number(event.queryStringParameters?.lessonId);
  if (!lessonId) return bad('lessonId required');
  const db = sql();

  const [row] = await db`
    SELECT l.position, c.lesson_count, e.release_mode, e.drip_start
    FROM lessons l
    JOIN classes c ON c.id = l.class_id
    JOIN enrollments e ON e.class_id = c.id AND e.family_id=${session.familyId}
    WHERE l.id=${lessonId} AND e.expires_at > now()`;
  if (!row) return bad('Not enrolled in this class', 403);

  const open = unlockedPositions({
    releaseMode: row.release_mode,
    dripStart: row.drip_start && new Date(row.drip_start).toISOString().slice(0, 10),
    lessonCount: row.lesson_count
  });
  if (!open.includes(row.position)) return bad('This lesson has not unlocked yet', 403);

  const content = await db`
    SELECT kind, payload FROM lesson_content WHERE lesson_id=${lessonId}`;
  return ok({ content: Object.fromEntries(content.map((c) => [c.kind, c.payload])) });
});
