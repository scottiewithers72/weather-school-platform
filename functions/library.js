// GET /api/library?school=canes|earthsphere
// The signed-in family's classes with per-lesson unlock state (drip engine),
// plus companion content for unlocked lessons.
import { sql } from './lib/db.js';
import { requireFamily } from './lib/auth.js';
import { handle, ok } from './lib/http.js';
import { unlockedPositions, nextUnlockDate } from './lib/core.js';

export const handler = handle(async (event) => {
  const session = requireFamily(event);
  const school = event.queryStringParameters?.school;
  const db = sql();

  const enrollments = await db`
    SELECT e.*, c.title, c.subtitle, c.grade_band, c.lesson_count, c.hero_image,
           c.school_id, c.credit_value
    FROM enrollments e JOIN classes c ON c.id = e.class_id
    WHERE e.family_id=${session.familyId}
      AND (${school || null}::text IS NULL OR c.school_id=${school || null})
      AND e.expires_at > now()
    ORDER BY c.sort_order`;

  const library = [];
  for (const e of enrollments) {
    const lessons = await db`
      SELECT id, position, title, summary, duration_min, video_id
      FROM lessons WHERE class_id=${e.class_id} ORDER BY position`;
    const open = new Set(unlockedPositions({
      releaseMode: e.release_mode,
      dripStart: e.drip_start && new Date(e.drip_start).toISOString().slice(0, 10),
      lessonCount: e.lesson_count
    }));
    library.push({
      classId: e.class_id,
      title: e.title,
      subtitle: e.subtitle,
      gradeBand: e.grade_band,
      heroImage: e.hero_image,
      schoolId: e.school_id,
      source: e.source,
      expiresAt: e.expires_at,
      nextUnlock: nextUnlockDate({
        releaseMode: e.release_mode,
        dripStart: e.drip_start && new Date(e.drip_start).toISOString().slice(0, 10),
        lessonCount: e.lesson_count
      }),
      lessons: lessons.map((l) => ({
        id: l.id,
        position: l.position,
        title: l.title,
        summary: l.summary,
        durationMin: l.duration_min,
        unlocked: open.has(l.position),
        videoId: open.has(l.position) ? l.video_id : null
      }))
    });
  }
  return ok({ library });
});
