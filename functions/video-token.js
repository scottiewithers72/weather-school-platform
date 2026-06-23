// GET /api/video-token?lessonId=123
// Issues a short-lived Bunny.net Stream token URL — video only plays for
// signed-in families whose drip schedule has unlocked the lesson.
import crypto from 'node:crypto';
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
    SELECT l.video_id, l.position, c.lesson_count, e.release_mode, e.drip_start
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
  if (!row.video_id) return bad('Video not yet published', 404);

  // Bunny token: sha256_hex(token_key + video_id + expires)
  const expires = Math.floor(Date.now() / 1000) + 3600 * 4;
  const token = crypto.createHash('sha256')
    .update(process.env.BUNNY_TOKEN_KEY + row.video_id + expires)
    .digest('hex');
  const embedUrl =
    `https://iframe.mediadelivery.net/embed/${process.env.BUNNY_LIBRARY_ID}/${row.video_id}` +
    `?token=${token}&expires=${expires}&autoplay=false`;
  return ok({ embedUrl, expires });
});
