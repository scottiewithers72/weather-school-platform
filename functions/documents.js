// GET /api/documents?lessonId=123          -> list of this week's printables (signed links)
// GET /api/documents?dl=<signed token>     -> the PDF itself
// Documents unlock on the same weekly schedule as the video. Links are signed
// per family and expire after 30 minutes, so a shared link stops working.
import { getDeployStore, getStore } from '@netlify/blobs';
import { sql } from './lib/db.js';
import { requireFamily, signToken, verifyToken } from './lib/auth.js';

import { unlockedPositions } from './lib/core.js';

const J = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const ok = (b) => J(200, b);
const bad = (msg, code = 400) => J(code, { error: msg });

const LABELS = {
  'parent-guide':    { label: 'Parent & Teacher Guide', group: 'parent',  order: 1 },
  'reading':         { label: 'Student Reading',        group: 'student', order: 2 },
  'homework':        { label: 'Homework',               group: 'student', order: 3 },
  'activity-sheet':  { label: 'Activity Sheet',         group: 'student', order: 4 },
  'student-handout': { label: 'Student Handout',        group: 'student', order: 5 },
  'quiz':            { label: 'Quiz',                   group: 'student', order: 6 },
  'certificate':     { label: 'Graduation Certificate', group: 'student', order: 7 }
};

async function unlockedLesson(db, familyId, lessonId) {
  const [row] = await db`
    SELECT l.position, c.lesson_count, e.release_mode, e.drip_start
    FROM lessons l
    JOIN classes c ON c.id = l.class_id
    JOIN enrollments e ON e.class_id = c.id AND e.family_id=${familyId}
    WHERE l.id=${lessonId} AND e.expires_at > now()`;
  if (!row) return { error: bad('Not enrolled in this class', 403) };
  const open = unlockedPositions({
    releaseMode: row.release_mode,
    dripStart: row.drip_start && new Date(row.drip_start).toISOString().slice(0, 10),
    lessonCount: row.lesson_count
  });
  if (!open.includes(row.position)) return { error: bad('This week has not unlocked yet', 403) };
  return { row };
}

// Modern (v2) function: Netlify injects the Blobs region/context automatically.
export default async (req) => {
  try { return await run(req); }
  catch (e) {
    if (e.statusCode && e.statusCode < 500) return bad(e.message, e.statusCode);
    console.error(e); return bad('Server error', 500);
  }
};

async function run(req) {
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const db = sql();

  // ----- download -----
  if (q.dl) {
    const t = verifyToken(q.dl);
    if (!t?.docId || !t?.familyId) return bad('This download link has expired — reopen the lesson to get a fresh one.', 403);
    const [doc] = await db`SELECT * FROM lesson_documents WHERE id=${t.docId}`;
    if (!doc) return bad('Document not found', 404);
    const { error } = await unlockedLesson(db, t.familyId, doc.lesson_id);
    if (error) return error;

    // Admin replacements (site store) win over the files shipped with the deploy.
    let data = await getStore('course-docs').get(doc.blob_key, { type: 'arrayBuffer' });
    if (!data) data = await getDeployStore().get(doc.blob_key, { type: 'arrayBuffer' });
    if (!data) return bad('File missing — we have been notified.', 404);

    return new Response(data, { status: 200, headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${q.view ? 'inline' : 'attachment'}; filename="${doc.file_name}"`,
      'Cache-Control': 'private, no-store'
    } });
  }

  // ----- list -----
  const session = requireFamily({ headers: { authorization: req.headers.get('authorization') || '' } });
  const lessonId = Number(q.lessonId);
  if (!lessonId) return bad('lessonId required');
  const { error } = await unlockedLesson(db, session.familyId, lessonId);
  if (error) return error;

  const docs = await db`SELECT id, kind, file_name, bytes FROM lesson_documents WHERE lesson_id=${lessonId}`;
  const documents = docs
    .filter((d) => LABELS[d.kind])
    .sort((a, b) => LABELS[a.kind].order - LABELS[b.kind].order)
    .map((d) => {
      const token = signToken({ docId: Number(d.id), familyId: session.familyId }, 30 / 1440);
      const url = `/api/documents?dl=${encodeURIComponent(token)}`;
      return { kind: d.kind, ...LABELS[d.kind], fileName: d.file_name,
               kb: d.bytes ? Math.round(d.bytes / 1024) : null,
               url, viewUrl: url + '&view=1' };
    });
  return ok({ documents });
}
