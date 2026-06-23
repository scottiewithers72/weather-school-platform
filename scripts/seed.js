// One-time database seed: applies schema.sql, then loads both catalogs.
// Usage: DATABASE_URL=postgres://... node scripts/seed.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const root = fileURLToPath(new URL('..', import.meta.url));

console.log('Applying schema...');
const schema = readFileSync(`${root}db/schema.sql`, 'utf8');
// split on semicolons at line ends, keep function bodies intact
for (const stmt of schema.split(/;\s*\n(?=(?:CREATE|DROP|ALTER|--|$))/)) {
  const s = stmt.trim();
  if (s) await sql.unsafe ? await sql.unsafe(s) : await sql(s);
}

for (const school of ['canes', 'earthsphere']) {
  const cat = JSON.parse(readFileSync(`${root}config/catalog-${school}.json`, 'utf8'));
  for (const c of cat.classes) {
    console.log(`Seeding ${school}: ${c.title}`);
    await sql`
      INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
        lesson_count, price_cents, semester, status, hero_image, credit_value,
        cohort_start, sort_order, is_graduation_gift)
      VALUES (${c.id}, ${school}, ${c.title}, ${c.subtitle}, ${c.description},
        ${c.grade_band}, ${c.lessons.length}, ${c.price_cents}, ${c.semester},
        ${c.status}, ${c.hero_image || null}, ${c.credit_value || 0},
        ${c.cohort_start || null}, ${c.sort_order || 100}, ${!!c.is_graduation_gift})
      ON CONFLICT (id) DO UPDATE SET
        title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
        lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
        semester=EXCLUDED.semester, status=EXCLUDED.status, hero_image=EXCLUDED.hero_image,
        cohort_start=EXCLUDED.cohort_start, sort_order=EXCLUDED.sort_order,
        is_graduation_gift=EXCLUDED.is_graduation_gift`;
    for (const l of c.lessons) {
      await sql`
        INSERT INTO lessons (class_id, position, title, summary, duration_min)
        VALUES (${c.id}, ${l.position}, ${l.title}, ${l.summary || null}, ${l.duration_min || null})
        ON CONFLICT (class_id, position) DO UPDATE SET
          title=EXCLUDED.title, duration_min=EXCLUDED.duration_min`;
    }
  }
}
console.log('Seed complete.');
