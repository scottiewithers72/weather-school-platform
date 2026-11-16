// Build step: copy course-docs/ into Netlify's deploy-scoped Blobs upload dir.
// Files in .netlify/blobs/deploy/ are uploaded with the deploy and read at
// runtime via getDeployStore(). Keys = path relative to course-docs/.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
const src = 'course-docs', dest = '.netlify/blobs/deploy';
if (existsSync(src)) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log('Staged course documents into', dest);
}
