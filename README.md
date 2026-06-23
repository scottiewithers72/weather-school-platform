# Weather School Platform
### Cane's Weather School (K–4) + EarthSphere Academy (5–12) — one codebase, two schools

Built per the June 11, 2026 handoff: Shopify is the cash register, this platform is where
students live, Bunny.net hosts the video. The companion app is a PWA (no app stores, no 30% cut).

---

## What's in this repo

| Path | What it is |
|---|---|
| `db/schema.sql` | Shared Postgres schema — families (max 4 students), classes, lessons, single-use access codes, enrollments with drip/evergreen modes, progress, discount + graduation automation state |
| `functions/` | The backend (Netlify Functions): `auth`, `redeem`, `shopify-webhook`, `library`, `content`, `progress`, `video-token`, `catalog`, `admin` |
| `functions/lib/core.js` | Pure business logic: code generation, drip engine, discount trigger, graduation detection — fully unit-tested |
| `sites/canes/` | CanesWeatherSchool.com — animated K–4 storefront + PWA app + admin panel |
| `sites/earthsphere/` | EarthSphereAcademy.com — 5–12 credibility-first storefront + PWA app + admin panel |
| `config/` | School configs + seed catalogs (7 Cane classes, 5 EarthSphere courses) |
| `scripts/seed.js` | Applies schema + loads both catalogs into the database |
| `scripts/collect-art.command` | **Double-click on your Mac** to copy the generated fal.ai art into both sites |
| `tests/run-tests.js` | 22 unit tests on the business logic (all passing) |

## Launch checklist (in order)

1. **Run `scripts/collect-art.command`** (double-click) — copies artwork into both sites.
2. **Database:** create a free Neon project (neon.tech) → run `DATABASE_URL=... npm run seed`.
3. **Netlify:** create TWO sites from this same repo/folder:
   - Site A → domain `canesweatherschool.com`, publish dir `sites/canes`
   - Site B → domain `earthsphereacademy.com`, publish dir `sites/earthsphere`
   - Set the env vars listed in `netlify.toml` on BOTH sites (same `DATABASE_URL` and
     `JWT_SECRET` on both — that's what makes the graduation handoff seamless).
4. **Shopify:** one store, products for each class. Paste each product's ID into the matching
   class in the admin panel (`/admin/` on either site, password = `ADMIN_PASSWORD`).
   Add an `orders/paid` webhook pointing to `https://canesweatherschool.com/api/shopify-webhook`.
   Wire the `SHOPIFY_URLS` map in each site's `enroll.html` to the product pages.
5. **Bunny.net:** create a Stream library with token authentication. As you record each lesson
   (Mon/Tue blocks, EarthSphere first), upload and paste the video GUID into the lesson in the
   admin panel. **September 2 only needs Lesson 1 of each fall class.**
6. **Email:** create a Resend (or Postmark) account; set `EMAIL_API_KEY` / `EMAIL_FROM`.
   Wire the lead-magnet form on the EarthSphere homepage to Mailchimp/Kit.

## How the automations work (no code needed after launch)

- **Purchase → app:** Shopify webhook → unique single-use code (`CANE-XXXX-XXXX`) → emailed
  with install steps → parent redeems in the app → code dies, class unlocks for the household.
- **Drip:** cohort classes unlock one lesson per week from `cohort_start` (Sep 2). Flip any
  class to evergreen with one button in admin when its cohort ends.
- **Engagement discount:** after a family uses the app on 4 distinct days, the backend mints a
  real single-use Shopify discount code (15%, 45-day expiry) and delivers it in-app + by email.
- **Graduation:** when any student in a family completes every live Cane's class (videos watched,
  quizzes passed), the designated EarthSphere gift class (`Weather Detectives`) unlocks free on
  the same account, with Cane's congratulations email.

## Adding Class #12 without a developer

Open `/admin/` on either site → **+ Add class** → fill the form → add lessons → paste content
JSON per lesson. Content payload shapes:

```json
// study_guide
{ "sections": [ { "heading": "Why thunder booms", "text": "..." } ] }
// flashcards (also powers the matching game)
{ "cards": [ { "front": "Cumulonimbus", "back": "The towering storm cloud" } ] }
// quiz — answer = index of correct choice; 70% passes
{ "questions": [ { "q": "What makes thunder?", "choices": ["Lightning","Rain","Wind"], "answer": 0 } ] }
// game (optional explicit pairs; falls back to flashcards)
{ "pairs": [ { "a": "Warm front", "b": "Gentle, steady rain" } ] }
```

## Non-negotiables honored

- Streaming only, behind login — no downloads, tokenized Bunny embeds.
- Family license: max 4 student profiles, enforced in app AND database.
- COPPA posture: students are first-name only, parent owns the account, no student emails.
- Never claims accreditation — documented hours + Completion Report, parent awards credit.
- One codebase: every fix ships to both schools; branding is configuration.

## Still on Scott's plate (from the handoff one-sheet)

- Confirm final pricing (placeholders: Cane's $59–99, EarthSphere $149–199) and the fall
  EarthSphere catalog cut. Edit in admin — no code.
- Confirm Sept 2 start; early-bird discount in Shopify through July 31.
- Register @earthsphereacademy social handles; USPTO check on "EarthSphere."
- Record Lesson 1 of each fall class by Sep 2; stay 2–3 weeks ahead all semester.
