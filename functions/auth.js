// POST /api/auth  { action: 'register'|'login'|'add_student'|'list_students' }
import { sql } from './lib/db.js';
import { hashPassword, verifyPassword, signToken, requireFamily } from './lib/auth.js';
import { handle, ok, bad, parseBody } from './lib/http.js';

export const handler = handle(async (event) => {
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const db = sql();
  const body = parseBody(event);

  if (body.action === 'register') {
    const { email, name, password, students = [] } = body;
    if (!email || !password || !name) return bad('email, name, password required');
    if (password.length < 8) return bad('Password must be at least 8 characters');
    if (students.length > 4) return bad('Up to 4 student profiles');
    const exists = await db`SELECT 1 FROM families WHERE parent_email=${email.toLowerCase()}`;
    if (exists.length) return bad('An account with that email already exists');
    const [fam] = await db`
      INSERT INTO families (parent_email, parent_name, password_hash)
      VALUES (${email.toLowerCase()}, ${name}, ${hashPassword(password)})
      RETURNING id, parent_email`;
    for (const s of students.slice(0, 4)) {
      await db`INSERT INTO students (family_id, first_name, avatar, grade_band)
               VALUES (${fam.id}, ${s.firstName}, ${s.avatar || 'cloud'}, ${s.gradeBand || null})`;
    }
    return ok({ token: signToken({ familyId: fam.id, email: fam.parent_email }) });
  }

  if (body.action === 'login') {
    const { email, password } = body;
    const [fam] = await db`SELECT * FROM families WHERE parent_email=${(email || '').toLowerCase()}`;
    if (!fam || !verifyPassword(password || '', fam.password_hash)) {
      return bad('Email or password incorrect', 401);
    }
    await db`UPDATE families SET last_login_at=now() WHERE id=${fam.id}`;
    return ok({ token: signToken({ familyId: fam.id, email: fam.parent_email }) });
  }

  if (body.action === 'add_student') {
    const session = requireFamily(event);
    const { firstName, avatar, gradeBand } = body;
    if (!firstName) return bad('firstName required');
    const count = await db`SELECT count(*)::int AS n FROM students WHERE family_id=${session.familyId}`;
    if (count[0].n >= 4) return bad('Family license allows up to 4 student profiles');
    const [s] = await db`
      INSERT INTO students (family_id, first_name, avatar, grade_band)
      VALUES (${session.familyId}, ${firstName}, ${avatar || 'cloud'}, ${gradeBand || null})
      RETURNING id, first_name, avatar, grade_band`;
    return ok({ student: s });
  }

  if (body.action === 'list_students') {
    const session = requireFamily(event);
    const students = await db`
      SELECT id, first_name, avatar, grade_band FROM students
      WHERE family_id=${session.familyId} ORDER BY id`;
    return ok({ students });
  }

  return bad('Unknown action');
});
