// Builds a COMPACT seed (schema + multi-row INSERTs) and writes it as a
// JSON-escaped JS payload that sets window.__SEED_SQL in the browser.
// Output: db/seed-inject.txt  (a single javascript_tool payload)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lit = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v === null || v === undefined || v === '' ? 'NULL' : Number(v));
const bool = (v) => (v ? 'true' : 'false');

let sql = readFileSync(`${root}db/schema.sql`, 'utf8').trim() + '\n\n';

const classRows = [];
const lessonRows = [];
for (const school of ['canes', 'earthsphere']) {
  const cat = JSON.parse(readFileSync(`${root}config/catalog-${school}.json`, 'utf8'));
  for (const c of cat.classes) {
    classRows.push(`(${lit(c.id)}, ${lit(school)}, ${lit(c.title)}, ${lit(c.subtitle)}, ${lit(c.description)}, ${lit(c.grade_band)}, ${c.lessons.length}, ${num(c.price_cents)}, ${lit(c.semester)}, ${lit(c.status)}, ${lit(c.shopify_product_id || null)}, ${lit(c.hero_image || null)}, ${num(c.credit_value) || 0}, ${lit(c.cohort_start || null)}, ${num(c.sort_order) || 100}, ${bool(c.is_graduation_gift)})`);
    for (const l of c.lessons) {
      lessonRows.push(`(${lit(c.id)}, ${num(l.position)}, ${lit(l.title)}, ${lit(l.summary || null)}, ${num(l.duration_min)})`);
    }
  }
}

sql += `INSERT INTO classes (id, school_id, title, subtitle, description, grade_band, lesson_count, price_cents, semester, status, shopify_product_id, hero_image, credit_value, cohort_start, sort_order, is_graduation_gift) VALUES\n`;
sql += classRows.join(',\n');
sql += `\nON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description, grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents, semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id, hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start, sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;\n\n`;

sql += `INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES\n`;
sql += lessonRows.join(',\n');
sql += `\nON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;\n`;

// JSON.stringify gives a safe double-quoted JS string literal (handles $$, quotes, newlines, unicode).
const payload = `window.__SEED_SQL = ${JSON.stringify(sql)}; window.__SEED_SQL.length`;
writeFileSync(`${root}db/seed-inject.txt`, payload);
console.log(`Wrote db/seed-inject.txt — payload ${payload.length} chars, ${classRows.length} classes, ${lessonRows.length} lessons.`);
