// POST /api/admin — the no-code backend for the admin panel.
// Auth: header  x-admin-key: $ADMIN_PASSWORD
// Actions: list_classes, upsert_class, delete_class, list_lessons,
//          upsert_lesson, delete_lesson, upsert_content, stats,
//          list_codes, generate_codes, flip_evergreen
import crypto from 'node:crypto';
import { sql } from './lib/db.js';
import { handle, ok, bad, parseBody } from './lib/http.js';
import { generateAccessCode } from './lib/core.js';

function requireAdmin(event) {
  const key = event.headers['x-admin-key'] || event.headers['X-Admin-Key'] || '';
  const expect = process.env.ADMIN_PASSWORD || '';
  const a = Buffer.from(key.padEnd(64).slice(0, 64));
  const b = Buffer.from(expect.padEnd(64).slice(0, 64));
  if (!expect || !crypto.timingSafeEqual(a, b)) {
    const err = new Error('Admin key required');
    err.statusCode = 401;
    throw err;
  }
}

export const handler = handle(async (event) => {
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  requireAdmin(event);
  const db = sql();
  const b = parseBody(event);

  switch (b.action) {
    case 'list_classes': {
      const classes = await db`SELECT * FROM classes ORDER BY school_id, sort_order`;
      return ok({ classes });
    }
    case 'upsert_class': {
      const c = b.class;
      await db`
        INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
          lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
          credit_value, cohort_start, sort_order, is_graduation_gift)
        VALUES (${c.id}, ${c.school_id}, ${c.title}, ${c.subtitle || null}, ${c.description || null},
          ${c.grade_band || null}, ${c.lesson_count || 0}, ${c.price_cents}, ${c.semester || null},
          ${c.status || 'draft'}, ${c.shopify_product_id || null}, ${c.hero_image || null},
          ${c.credit_value || 0}, ${c.cohort_start || null}, ${c.sort_order || 100},
          ${!!c.is_graduation_gift})
        ON CONFLICT (id) DO UPDATE SET
          title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
          grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count,
          price_cents=EXCLUDED.price_cents, semester=EXCLUDED.semester, status=EXCLUDED.status,
          shopify_product_id=EXCLUDED.shopify_product_id, hero_image=EXCLUDED.hero_image,
          credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
          sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift`;
      return ok({ saved: c.id });
    }
    case 'delete_class': {
      await db`DELETE FROM classes WHERE id=${b.classId}`;
      return ok({ deleted: b.classId });
    }
    case 'list_lessons': {
      const lessons = await db`
        SELECT l.*, (SELECT json_agg(kind) FROM lesson_content lc WHERE lc.lesson_id=l.id) AS content_kinds
        FROM lessons l WHERE class_id=${b.classId} ORDER BY position`;
      return ok({ lessons });
    }
    case 'upsert_lesson': {
      const l = b.lesson;
      const [row] = await db`
        INSERT INTO lessons (class_id, position, title, summary, video_id, duration_min)
        VALUES (${l.class_id}, ${l.position}, ${l.title}, ${l.summary || null},
                ${l.video_id || null}, ${l.duration_min || null})
        ON CONFLICT (class_id, position) DO UPDATE SET
          title=EXCLUDED.title, summary=EXCLUDED.summary,
          video_id=EXCLUDED.video_id, duration_min=EXCLUDED.duration_min
        RETURNING id`;
      await db`
        UPDATE classes SET lesson_count=(SELECT count(*) FROM lessons WHERE class_id=${l.class_id})
        WHERE id=${l.class_id}`;
      return ok({ lessonId: row.id });
    }
    case 'delete_lesson': {
      await db`DELETE FROM lessons WHERE id=${b.lessonId}`;
      return ok({ deleted: b.lessonId });
    }
    case 'upsert_content': {
      await db`
        INSERT INTO lesson_content (lesson_id, kind, payload)
        VALUES (${b.lessonId}, ${b.kind}, ${JSON.stringify(b.payload)})
        ON CONFLICT (lesson_id, kind) DO UPDATE SET payload=EXCLUDED.payload`;
      return ok({ saved: b.kind });
    }
    case 'flip_evergreen': {
      // Cohort ends -> catalog flips to start-anytime
      await db`UPDATE classes SET status='evergreen' WHERE id=${b.classId}`;
      return ok({ evergreen: b.classId });
    }
    case 'generate_codes': {
      // Manual codes (review copies, refund replacements, promos)
      const [cls] = await db`SELECT school_id FROM classes WHERE id=${b.classId}`;
      if (!cls) return bad('Class not found');
      const codes = [];
      for (let i = 0; i < Math.min(b.count || 1, 100); i++) {
        const code = generateAccessCode(cls.school_id);
        await db`INSERT INTO access_codes (code, class_id, order_id, order_email)
                 VALUES (${code}, ${b.classId}, 'manual', ${b.note || 'admin'})`;
        codes.push(code);
      }
      return ok({ codes });
    }
    case 'list_codes': {
      const codes = await db`
        SELECT code, class_id, order_email, created_at, redeemed_at
        FROM access_codes WHERE class_id=${b.classId}
        ORDER BY created_at DESC LIMIT 200`;
      return ok({ codes });
    }
    case 'stats': {
      const [families] = await db`SELECT count(*)::int AS n FROM families`;
      const [enrollments] = await db`SELECT count(*)::int AS n FROM enrollments`;
      const [grads] = await db`SELECT count(*)::int AS n FROM graduations`;
      const [discounts] = await db`SELECT count(*)::int AS n FROM discount_grants`;
      const byClass = await db`
        SELECT class_id, count(*)::int AS n FROM enrollments GROUP BY class_id ORDER BY n DESC`;
      return ok({ families: families.n, enrollments: enrollments.n,
                  graduations: grads.n, discounts: discounts.n, byClass });
    }
    default:
      return bad('Unknown action');
  }
});
