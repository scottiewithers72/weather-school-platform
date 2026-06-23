// Generates a single seed.sql (schema + both catalogs) that can be pasted
// straight into the Neon SQL Editor. No network needed.
// Usage: node scripts/gen-seed-sql.js  ->  writes db/seed.sql
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined || v === '' ? 'NULL' : Number(v));
const b = (v) => (v ? 'true' : 'false');

let out = '-- ============================================================\n';
out += '-- Weather School Platform — FULL SEED (schema + catalog)\n';
out += '-- Paste this whole file into the Neon SQL Editor and Run.\n';
out += '-- Safe to re-run (idempotent: CREATE IF NOT EXISTS + ON CONFLICT).\n';
out += '-- ============================================================\n\n';

out += readFileSync(`${root}db/schema.sql`, 'utf8').trim() + '\n\n';
out += '-- ---------- Catalog data ----------\n';

let classCount = 0, lessonCount = 0;
for (const school of ['canes', 'earthsphere']) {
  const cat = JSON.parse(readFileSync(`${root}config/catalog-${school}.json`, 'utf8'));
  for (const c of cat.classes) {
    classCount++;
    out += `\nINSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  ${q(c.id)}, ${q(school)}, ${q(c.title)}, ${q(c.subtitle)}, ${q(c.description)}, ${q(c.grade_band)},
  ${c.lessons.length}, ${n(c.price_cents)}, ${q(c.semester)}, ${q(c.status)}, ${q(c.shopify_product_id || null)}, ${q(c.hero_image || null)},
  ${n(c.credit_value) || 0}, ${q(c.cohort_start || null)}, ${n(c.sort_order) || 100}, ${b(c.is_graduation_gift)})
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;\n`;
    for (const l of c.lessons) {
      lessonCount++;
      out += `INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES (${q(c.id)}, ${n(l.position)}, ${q(l.title)}, ${q(l.summary || null)}, ${n(l.duration_min)})
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;\n`;
    }
  }
}

writeFileSync(`${root}db/seed.sql`, out);
console.log(`Wrote db/seed.sql — ${classCount} classes, ${lessonCount} lessons.`);
