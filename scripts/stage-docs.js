// Build step: publish course-docs/ to the deploy-scoped Netlify Blobs store using the
// Frameworks API layout: .netlify/v1/blobs/deploy/<key>/blob  (key = path under course-docs/).
// Read at runtime by functions/documents.js via getDeployStore().
import { readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
const src = 'course-docs', dest = '.netlify/v1/blobs/deploy';
let n = 0;
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const out = join(dest, relative(src, p));
    mkdirSync(out, { recursive: true });
    copyFileSync(p, join(out, 'blob'));
    n++;
  }
}
if (existsSync(src)) walk(src);
console.log(`Staged ${n} course documents into ${dest}`);
