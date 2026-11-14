// GET /api/office-hours?school=canes|earthsphere
// Weekly live Zoom office hours for the classes this family is enrolled in.
// The Zoom link is only returned inside the join window (10 min before -> end),
// so it never sits in the app for sharing.
import { sql } from './lib/db.js';
import { requireFamily } from './lib/auth.js';
import { handle, ok } from './lib/http.js';
import { nextSession } from './lib/core.js';

const iso = (d) => d && new Date(d).toISOString().slice(0, 10);

export const handler = handle(async (event) => {
  const session = requireFamily(event);
  const school = event.queryStringParameters?.school || null;
  const db = sql();

  const enrolled = await db`
    SELECT c.id, c.school_id FROM enrollments e JOIN classes c ON c.id = e.class_id
    WHERE e.family_id=${session.familyId} AND e.expires_at > now()
      AND (${school}::text IS NULL OR c.school_id=${school})`;
  if (!enrolled.length) return ok({ officeHours: [] });
  const classIds = enrolled.map((r) => r.id);
  const schools = [...new Set(enrolled.map((r) => r.school_id))];

  const slots = await db`
    SELECT oh.*, c.title AS class_title,
      COALESCE((SELECT json_agg(s.skip_date) FROM office_hours_skips s
                WHERE s.office_hour_id = oh.id AND s.skip_date >= CURRENT_DATE - 1), '[]') AS skips
    FROM office_hours oh LEFT JOIN classes c ON c.id = oh.class_id
    WHERE oh.active
      AND ((oh.class_id IS NULL AND oh.school_id = ANY(${schools}))
           OR oh.class_id = ANY(${classIds}))
    ORDER BY oh.weekday, oh.start_time`;

  const now = new Date();
  const officeHours = slots.map((s) => {
    const next = nextSession({
      weekday: s.weekday, startTime: s.start_time, durationMin: s.duration_min,
      startsOn: iso(s.starts_on), skips: (s.skips || []).map(iso), now
    });
    return {
      id: s.id,
      classId: s.class_id,           // null = covers every class in the school
      label: s.label,
      classTitle: s.class_title,
      durationMin: s.duration_min,
      start: next?.start || null,
      end: next?.end || null,
      joinable: !!next?.joinable,
      linkReady: !!s.zoom_url,
      zoomUrl: next?.joinable ? s.zoom_url : null
    };
  });
  return ok({ officeHours });
});
