// POST /api/progress { studentId, lessonId, videoDone?, quizScore?, flashcardsDone?, gameDone? }
// Records progress, logs a usage day, then runs the two automations:
//   1. Engagement discount (>=4 distinct usage days -> real Shopify code, 45-day expiry)
//   2. Graduation detection (all Cane's classes complete -> free EarthSphere class)
import { sql } from './lib/db.js';
import { requireFamily } from './lib/auth.js';
import { handle, ok, bad, parseBody } from './lib/http.js';
import { discountEligible, isGraduated, licenseExpiry, generateAccessCode } from './lib/core.js';
import { createSingleUseDiscount } from './lib/shopify.js';
import { sendEmail, discountHtml, graduationHtml } from './lib/email.js';

const QUIZ_PASS = 70;

export const handler = handle(async (event) => {
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const session = requireFamily(event);
  const db = sql();
  const b = parseBody(event);

  // student must belong to this family
  const [stu] = await db`
    SELECT id FROM students WHERE id=${b.studentId} AND family_id=${session.familyId}`;
  if (!stu) return bad('Student not found on your account', 404);

  const quizPassed = b.quizScore != null ? Number(b.quizScore) >= QUIZ_PASS : null;
  await db`
    INSERT INTO progress (student_id, lesson_id, video_done, quiz_score, quiz_passed,
                          flashcards_done, game_done, updated_at)
    VALUES (${b.studentId}, ${b.lessonId},
            ${!!b.videoDone}, ${b.quizScore ?? null}, ${quizPassed ?? false},
            ${!!b.flashcardsDone}, ${!!b.gameDone}, now())
    ON CONFLICT (student_id, lesson_id) DO UPDATE SET
      video_done      = progress.video_done OR EXCLUDED.video_done,
      quiz_score      = GREATEST(COALESCE(progress.quiz_score,0), COALESCE(EXCLUDED.quiz_score,0)),
      quiz_passed     = progress.quiz_passed OR EXCLUDED.quiz_passed,
      flashcards_done = progress.flashcards_done OR EXCLUDED.flashcards_done,
      game_done       = progress.game_done OR EXCLUDED.game_done,
      updated_at      = now()`;

  await db`
    INSERT INTO usage_days (family_id, used_on) VALUES (${session.familyId}, CURRENT_DATE)
    ON CONFLICT DO NOTHING`;

  const notices = [];

  // ----- Automation 1: engagement discount -----
  const [{ n: usageDays }] = await db`
    SELECT count(*)::int AS n FROM usage_days WHERE family_id=${session.familyId}`;
  const [grant] = await db`
    SELECT 1 FROM discount_grants WHERE family_id=${session.familyId}`;
  if (discountEligible({ distinctUsageDays: usageDays, hasExistingGrant: !!grant })) {
    try {
      const code = `THANKS-${generateAccessCode('canes').split('-').slice(1).join('')}`;
      const { expiresAt } = await createSingleUseDiscount({ code, percent: 15, days: 45 });
      await db`
        INSERT INTO discount_grants (family_id, shopify_code, percent_off, expires_at, notified)
        VALUES (${session.familyId}, ${code}, 15, ${expiresAt}, true)
        ON CONFLICT (family_id) DO NOTHING`;
      await sendEmail({
        to: session.email,
        subject: "You've earned 15% off your next class",
        html: discountHtml({
          schoolName: "our schools", code, percent: 15,
          expires: expiresAt.slice(0, 10),
          storeUrl: 'https://canesweatherschool.com'
        }),
        template: 'discount', ref: `family-${session.familyId}`
      });
      notices.push({ type: 'discount', code, expiresAt });
    } catch (e) { console.error('discount automation failed', e); }
  }

  // ----- Automation 2: graduation pipeline -----
  const [grad] = await db`SELECT 1 FROM graduations WHERE family_id=${session.familyId}`;
  if (!grad) {
    const caneClasses = await db`
      SELECT id, lesson_count FROM classes
      WHERE school_id='canes' AND status IN ('live','evergreen')`;
    // best completion per class across the family's students
    const rows = await db`
      SELECT l.class_id, p.student_id, count(*)::int AS done
      FROM progress p
      JOIN lessons l ON l.id = p.lesson_id
      JOIN students s ON s.id = p.student_id
      WHERE s.family_id=${session.familyId} AND p.video_done
        AND (p.quiz_passed OR NOT EXISTS
             (SELECT 1 FROM lesson_content lc WHERE lc.lesson_id=l.id AND lc.kind='quiz'))
      GROUP BY l.class_id, p.student_id`;
    const completionMap = {};
    for (const r of rows) {
      completionMap[r.class_id] = Math.max(completionMap[r.class_id] || 0, r.done);
    }
    const graduated = isGraduated({
      caneClasses: caneClasses.map((c) => ({ id: c.id, lessonCount: c.lesson_count })),
      completionMap
    });
    if (graduated) {
      const [gift] = await db`
        SELECT id, title FROM classes
        WHERE school_id='earthsphere' AND is_graduation_gift LIMIT 1`;
      await db`
        INSERT INTO graduations (family_id, gift_class_id, gift_unlocked)
        VALUES (${session.familyId}, ${gift?.id || null}, ${!!gift})
        ON CONFLICT (family_id) DO NOTHING`;
      if (gift) {
        await db`
          INSERT INTO enrollments (family_id, class_id, source, release_mode, drip_start, expires_at)
          VALUES (${session.familyId}, ${gift.id}, 'graduation_gift', 'all_now',
                  CURRENT_DATE, ${licenseExpiry()})
          ON CONFLICT (family_id, class_id) DO NOTHING`;
        await sendEmail({
          to: session.email,
          subject: '🎓 Cane has a graduation gift for your family!',
          html: graduationHtml({
            giftClassName: gift.title,
            academyUrl: 'https://earthsphereacademy.com/app/'
          }),
          template: 'graduation', ref: `family-${session.familyId}`
        });
        notices.push({ type: 'graduation', giftClass: gift.title });
      }
    }
  }

  return ok({ saved: true, notices });
});
