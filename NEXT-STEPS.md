# Next Steps — Weather School Launch
*Updated June 12, 2026 (overnight build session). Items marked 🤖 are things Claude does — just say the word. Everything else needs you.*

## 1. Quick reviews (5 minutes, do first)
- [ ] **Look at both sites** (open `sites/canes/index.html` and `sites/earthsphere/index.html`). Overnight changes: official Cane art on every class card, your 8 backgrounds worked into the Cane site, and the EarthSphere hero is now the spinning Earth with blue atmosphere on a starfield, as you specced.
- [x] **Official logo — DONE June 12.** Found your saved file, cropped it, made the background transparent, and placed it in the site header.
- [ ] **Cane lock retraining:** I curated your 19 on-model images into `assets/cane-refs/` and started the retrain, but the request timed out before fal confirmed. 🤖 Next session, tell me "retrain Cane and regenerate the off-model cards" — only the Volcanoes and Ocean cards (January classes) still show the wrong dog.

## 2. Accounts to set up (the go-live plumbing — roughly an evening)
- [ ] **Neon.tech** (free tier) — create a project, copy the connection string. 🤖 I run the seed script.
- [ ] **Netlify** — two sites from the one codebase; point canesweatherschool.com and earthsphereacademy.com at them. 🤖 I provide every env var (they're listed in `netlify.toml`).
- [x] **Shopify — DONE June 12.** All 19 class products are in your CaneTheWeatherDog store as **drafts** with prices, descriptions, and SKUs, and the enroll buttons on both sites are already wired to them. Your part: review the drafts, then flip the fall classes to Active when ready to sell. Still needed: add an `orders/paid` webhook (Settings → Notifications → Webhooks) pointing at `https://canesweatherschool.com/api/shopify-webhook` once Netlify is live.
- [ ] **Bunny.net** — create a Stream library with token authentication; copy the library ID + token key into Netlify env vars.
- [ ] **Resend.com** (or Postmark) — transactional email for access codes; verify your sending domain.
- [ ] **Mailchimp or Kit** — wire the lead-magnet form on the EarthSphere homepage; the 5-email welcome sequence is already written (`Academy-Email-Welcome-Sequence.md`).
- [ ] **Social handles** — register @earthsphereacademy and @canesweatherschool on IG, TikTok, YouTube, Facebook, X before someone else does.
- [ ] **USPTO TESS search** on "EarthSphere" (15 minutes; do before spending on branding).

## 3. Decisions only you can make
- [ ] **Final pricing** — placeholders live: Cane's $59–$99, EarthSphere $149–$199. Change anytime in the admin panel, no code.
- [ ] **Confirm the fall catalog cut** — currently: Cane's fall = Storms 101, Hurricane Hunters, Weather Academy; EarthSphere fall = Meteorology Sem 1, Weather Detectives, Weather & Climate (7–8), Severe Weather & Forecasting. Everything else says "Coming January."
- [ ] **Confirm Sept 2 start date** and **Weather Detectives as the graduation-gift class** (both are set as defaults).
- [ ] **Approve the Weather Academy 4-week arc** (flagged in your master index as my proposed sequence).
- [ ] **Verify NGSS codes** against your state's standards before printing teacher-facing materials.

## 4. Content production (your Mon/Tue blocks, July–August)
- [ ] **Record Lesson 1 of each fall class by Sept 2** — that's all the drip model requires for launch day: 4 EarthSphere lessons + 3 Cane's lessons. EarthSphere first (higher price, transcript deadlines).
- [ ] Then stay **2–3 lessons ahead** of the weekly release calendar all semester.
- [ ] Upload each video to Bunny, paste its ID into the lesson in the admin panel — that's the whole publish flow.
- [ ] 🤖 I can draft every study guide, flash-card deck, and quiz from your existing lesson plans and load them into the app — say "build the companion content."

## 5. What's already done (don't redo)
Platform code (backend, both sites, both PWA apps, admin panel), database schema, catalog matching your blueprint docs, access-code/drip/discount/graduation automations, all art mapped from your approved files, and 22/22 tests passing.

**The critical path is Section 2.** Everything else can move while accounts get created.
