-- ============================================================
-- Weather School Platform — FULL SEED (schema + catalog)
-- Paste this whole file into the Neon SQL Editor and Run.
-- Safe to re-run (idempotent: CREATE IF NOT EXISTS + ON CONFLICT).
-- ============================================================

-- =====================================================================
-- Weather School Platform — shared database schema (Postgres / Neon)
-- One database serves BOTH schools. school_id = 'canes' | 'earthsphere'
-- COPPA posture: students are first-name-only, no student emails.
-- =====================================================================

-- ---------- Families & students ----------
CREATE TABLE IF NOT EXISTS families (
  id            BIGSERIAL PRIMARY KEY,
  parent_email  TEXT UNIQUE NOT NULL,
  parent_name   TEXT NOT NULL,
  password_hash TEXT NOT NULL,            -- scrypt hash
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS students (
  id           BIGSERIAL PRIMARY KEY,
  family_id    BIGINT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  first_name   TEXT NOT NULL,             -- first name ONLY (COPPA)
  avatar       TEXT NOT NULL DEFAULT 'cloud',
  grade_band   TEXT,                      -- 'K-2','3-4','5-6','7-8','9-12'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- max 4 students per family, enforced in app layer AND here:
CREATE OR REPLACE FUNCTION enforce_family_size() RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM students WHERE family_id = NEW.family_id) >= 4 THEN
    RAISE EXCEPTION 'Family license allows up to 4 student profiles';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_family_size ON students;
CREATE TRIGGER trg_family_size BEFORE INSERT ON students
  FOR EACH ROW EXECUTE FUNCTION enforce_family_size();

-- ---------- Catalog ----------
CREATE TABLE IF NOT EXISTS classes (
  id             TEXT PRIMARY KEY,        -- slug e.g. 'cw-storms-101'
  school_id      TEXT NOT NULL CHECK (school_id IN ('canes','earthsphere')),
  title          TEXT NOT NULL,
  subtitle       TEXT,
  description    TEXT,
  grade_band     TEXT,
  lesson_count   INT NOT NULL DEFAULT 0,
  price_cents    INT NOT NULL,
  semester       TEXT,                    -- 'Fall 2026', 'Coming January', 'Evergreen'
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','presale','live','evergreen','archived')),
  shopify_product_id TEXT,                -- maps webhook line items -> class
  hero_image     TEXT,
  credit_value   NUMERIC(3,2) DEFAULT 0,  -- 0.5 per semester class (EarthSphere)
  cohort_start   DATE,                    -- fall-cohort drip anchor (e.g. 2026-09-02)
  sort_order     INT NOT NULL DEFAULT 100,
  is_graduation_gift BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lessons (
  id           BIGSERIAL PRIMARY KEY,
  class_id     TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  position     INT NOT NULL,              -- 1..12
  title        TEXT NOT NULL,
  summary      TEXT,
  video_id     TEXT,                      -- Bunny.net Stream video GUID
  duration_min INT,
  UNIQUE (class_id, position)
);

-- Companion-app content, one row per lesson per kind
CREATE TABLE IF NOT EXISTS lesson_content (
  id        BIGSERIAL PRIMARY KEY,
  lesson_id BIGINT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL CHECK (kind IN ('study_guide','flashcards','quiz','game')),
  payload   JSONB NOT NULL,               -- structured content (see docs in README)
  UNIQUE (lesson_id, kind)
);

-- ---------- Purchases & access ----------
CREATE TABLE IF NOT EXISTS access_codes (
  code        TEXT PRIMARY KEY,           -- e.g. CANE-7G2K-Q9XD
  class_id    TEXT NOT NULL REFERENCES classes(id),
  order_id    TEXT,                       -- Shopify order id
  order_email TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_by BIGINT REFERENCES families(id),
  redeemed_at TIMESTAMPTZ                 -- non-null = code is DEAD
);

CREATE TABLE IF NOT EXISTS enrollments (
  id            BIGSERIAL PRIMARY KEY,
  family_id     BIGINT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  class_id      TEXT NOT NULL REFERENCES classes(id),
  source        TEXT NOT NULL DEFAULT 'code'
                CHECK (source IN ('code','graduation_gift','admin')),
  release_mode  TEXT NOT NULL DEFAULT 'drip'
                CHECK (release_mode IN ('drip','all_now')),
  drip_start    DATE,                     -- cohort: school calendar date; evergreen: enrollment date
  starts_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,     -- 12-month family license
  UNIQUE (family_id, class_id)
);

-- Per-student, per-lesson progress
CREATE TABLE IF NOT EXISTS progress (
  id            BIGSERIAL PRIMARY KEY,
  student_id    BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  lesson_id     BIGINT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  video_done    BOOLEAN NOT NULL DEFAULT false,
  quiz_score    NUMERIC(5,2),
  quiz_passed   BOOLEAN NOT NULL DEFAULT false,
  flashcards_done BOOLEAN NOT NULL DEFAULT false,
  game_done     BOOLEAN NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, lesson_id)
);

-- App-usage ping log → powers the engaged-family discount trigger
CREATE TABLE IF NOT EXISTS usage_days (
  family_id  BIGINT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  used_on    DATE NOT NULL,
  PRIMARY KEY (family_id, used_on)
);

-- ---------- Automation state ----------
CREATE TABLE IF NOT EXISTS discount_grants (
  id           BIGSERIAL PRIMARY KEY,
  family_id    BIGINT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  shopify_code TEXT NOT NULL,             -- real single-use Shopify discount code
  percent_off  INT NOT NULL DEFAULT 15,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,      -- 45 days
  notified     BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (family_id)                      -- one engagement discount per family (adjust later if desired)
);

CREATE TABLE IF NOT EXISTS graduations (
  id           BIGSERIAL PRIMARY KEY,
  family_id    BIGINT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  student_id   BIGINT REFERENCES students(id),
  graduated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gift_class_id TEXT REFERENCES classes(id),
  gift_unlocked BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (family_id)
);

-- Outbound email log (idempotency + audit)
CREATE TABLE IF NOT EXISTS email_log (
  id         BIGSERIAL PRIMARY KEY,
  to_email   TEXT NOT NULL,
  template   TEXT NOT NULL,               -- 'code_delivery','discount','graduation', ...
  ref        TEXT,                        -- order id / code / etc.
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template, ref)
);

-- ---------- Indexes ----------
CREATE INDEX IF NOT EXISTS idx_students_family   ON students(family_id);
CREATE INDEX IF NOT EXISTS idx_enroll_family     ON enrollments(family_id);
CREATE INDEX IF NOT EXISTS idx_lessons_class     ON lessons(class_id);
CREATE INDEX IF NOT EXISTS idx_progress_student  ON progress(student_id);
CREATE INDEX IF NOT EXISTS idx_classes_school    ON classes(school_id, status);

-- ---------- Catalog data ----------

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'cw-storms-101', 'canes', 'Storms 101', 'Thunder, lightning, and how we stay safe', 'Cane''s classic first class, expanded into a video mini-course. What makes a storm, why thunder booms, and the safety steps every weather hero knows. Every lesson ends on ''here''s how we stay safe'' — never on the scary part.', 'K–2',
  6, 5900, 'Fall 2026', 'presale', '10526629691679', '/assets/art/canes-storms-101.jpg',
  0, '2026-09-02', 10, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-storms-101', 1, 'Meet the Sky: What Is Weather?', NULL, 20)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-storms-101', 2, 'Clouds Are Clues', NULL, 20)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-storms-101', 3, 'BOOM! Why Thunder Happens', NULL, 20)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-storms-101', 4, 'Lightning: Nature''s Spark', NULL, 20)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-storms-101', 5, 'Rain, Hail, and Wild Wind', NULL, 20)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-storms-101', 6, 'Be a Weather Hero: Our Storm Safety Plan', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'cw-hurricane-hunters', 'canes', 'Hurricane Hunters', 'Fly into the storm with Cane', 'How hurricanes are born over warm ocean water, how scientists fly INTO them to keep us safe, and how families make a hurricane plan together.', '1–4',
  6, 6900, 'Fall 2026', 'presale', '10526629724447', '/assets/art/canes-hurricane-hunters.jpg',
  0, '2026-09-02', 20, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-hurricane-hunters', 1, 'Where Hurricanes Are Born', NULL, 22)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-hurricane-hunters', 2, 'The Eye of the Storm', NULL, 22)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-hurricane-hunters', 3, 'Hurricane Hunters: Scientists Who Fly In', NULL, 22)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-hurricane-hunters', 4, 'Watches, Warnings, and What They Mean', NULL, 22)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-hurricane-hunters', 5, 'Storm Surge: Why We Move Away From Water', NULL, 22)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-hurricane-hunters', 6, 'Our Family Hurricane Plan', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'cw-weather-academy', 'canes', 'Cane''s Weather Academy', 'The full weather adventure — 8 weeks', 'Cane''s flagship K–4 course: a full semester-unit journey through everything weather — sun, clouds, rain, storms, seasons, and forecasting like a real meteorologist.', 'K–4',
  8, 9900, 'Fall 2026', 'presale', '10526629822751', '/assets/art/canes-weather-academy.jpg',
  0, '2026-09-02', 30, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-weather-academy', 1, 'What Makes Weather? The Sun Starts It All', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-weather-academy', 2, 'The Water Cycle: Nature''s Recycling', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-weather-academy', 3, 'Cloud Detectives', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-weather-academy', 4, 'Wind: Air on the Move', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-weather-academy', 5, 'Wild Storms and Staying Safe', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-weather-academy', 6, 'The Four Seasons and Why They Change', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-weather-academy', 7, 'Forecast Like a Meteorologist', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-weather-academy', 8, 'Graduation Weathercast: Your Turn On Camera!', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'cw-sun-our-weather', 'canes', 'The Sun & Our Weather', 'The star that runs the show', 'Why the Sun is the engine of all our weather — day and night, seasons, and sun safety.', 'K–5',
  6, 5900, 'Coming January', 'presale', '10526629855519', '/assets/art/canes-sun.jpg',
  0, '2027-01-11', 40, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-sun-our-weather', 1, 'Our Star, the Sun', NULL, 22)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-sun-our-weather', 2, 'Day, Night, and Shadows', NULL, 22)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-sun-our-weather', 3, 'How the Sun Makes Wind and Rain', NULL, 22)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-sun-our-weather', 4, 'Seasons: The Earth''s Big Trip', NULL, 22)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-sun-our-weather', 5, 'Sun Safety: Protecting Our Skin and Eyes', NULL, 22)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-sun-our-weather', 6, 'Solar Scientists: Watching the Sun', NULL, 22)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'cw-volcanoes-earthquakes', 'canes', 'Volcanoes & Earthquakes', 'When the Earth rumbles', 'Inside our planet: why volcanoes erupt, why the ground shakes, and how scientists monitor and warn so people stay safe.', '3–5',
  6, 6900, 'Coming January', 'presale', '10526629921055', '/assets/art/canes-volcanoes.jpg',
  0, '2027-01-11', 50, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-volcanoes-earthquakes', 1, 'A Journey to the Center of the Earth', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-volcanoes-earthquakes', 2, 'Plates on the Move', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-volcanoes-earthquakes', 3, 'Volcanoes: Mountains That Wake Up', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-volcanoes-earthquakes', 4, 'Earthquakes: Why the Ground Shakes', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-volcanoes-earthquakes', 5, 'The Scientists Who Listen to the Earth', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-volcanoes-earthquakes', 6, 'Drop, Cover, Hold On: Our Safety Plan', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'cw-amazing-ocean', 'canes', 'Our Amazing Ocean', 'Waves, currents, and tsunami science', 'The ocean that covers most of our planet — currents, waves, sea life zones, and how warning centers watch for tsunamis to keep coasts safe.', '3–5',
  6, 6900, 'Coming January', 'presale', '10526629953823', '/assets/art/canes-ocean.jpg',
  0, '2027-01-11', 60, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-amazing-ocean', 1, 'One Big Ocean', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-amazing-ocean', 2, 'Currents: Rivers in the Sea', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-amazing-ocean', 3, 'Waves and Tides', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-amazing-ocean', 4, 'The Ocean Makes Our Weather', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-amazing-ocean', 5, 'Tsunamis and the Scientists Who Watch', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-amazing-ocean', 6, 'Ocean Heroes: Keeping Our Sea Healthy', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'cw-earth-explorers', 'canes', 'Cane''s Earth Explorers', 'The whole-planet adventure — 8 weeks', 'Cane''s big earth-science course: inside the planet, volcanoes, floods, wildfires, drought, oceans, the Sun, and our changing climate — each week ending with how scientists and families stay safe.', '3–5',
  8, 9900, 'Coming January', 'presale', '10526629986591', '/assets/art/canes-earth-explorers.jpg',
  0, '2027-01-11', 70, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-earth-explorers', 1, 'Inside Our Planet', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-earth-explorers', 2, 'Volcanoes & Earthquakes', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-earth-explorers', 3, 'Floods & the Water Cycle', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-earth-explorers', 4, 'Wildfires', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-earth-explorers', 5, 'Drought', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-earth-explorers', 6, 'Oceans & Currents', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-earth-explorers', 7, 'The Sun & Our Weather', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('cw-earth-explorers', 8, 'Our Changing Climate — and the Helpers', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-meteorology-sem1', 'earthsphere', 'Meteorology: Lab Science — Semester 1', 'The flagship. Atmosphere, energy, pressure, maps, moisture, clouds, fronts, cyclones', 'The first half of the flagship full-year lab science (grades 9–12), taught by a four-time Emmy-winning broadcast meteorologist. Units 1–8 with documented labs, reading guides, graded work, and a semester exam. Two semesters = 1.0 transcript-ready lab-science credit, parent-awarded with our Completion Report.', '9–12',
  8, 19900, 'Fall 2026', 'presale', '10526630019359', '/assets/art/es-meteorology.jpg',
  0.5, '2026-09-02', 10, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem1', 1, 'Intro to Meteorology & the Atmosphere', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem1', 2, 'Energy, Heat & Temperature', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem1', 3, 'Air Pressure & Wind', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem1', 4, 'Reading Weather Maps', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem1', 5, 'Atmospheric Moisture & Humidity', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem1', 6, 'Clouds & Precipitation', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem1', 7, 'Air Masses & Fronts', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem1', 8, 'Mid-Latitude Cyclones + Semester Exam', NULL, 35)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-weather-detectives', 'earthsphere', 'Weather Detectives', 'Intro meteorology for grades 5–6 — the step up from Cane, without the cartoon', 'Band A''s project-driven intro: observation skills, weather instruments, map reading, and your student''s first real forecasts. 8 units. This is the class Cane gives FREE to families who finish every Cane''s Weather School class.', '5–6',
  8, 14900, 'Fall 2026', 'presale', '10526630052127', '/assets/art/es-weather-detectives.jpg',
  0, '2026-09-02', 20, true)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-detectives', 1, 'Thinking Like a Scientist', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-detectives', 2, 'Weather Instruments & Your Home Station', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-detectives', 3, 'Reading the Sky: Clouds & Patterns', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-detectives', 4, 'Weather Maps for Real', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-detectives', 5, 'Track a Storm Week', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-detectives', 6, 'Severe Weather Science', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-detectives', 7, 'Climate vs. Weather', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-detectives', 8, 'Your First Forecast Project', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-weather-climate-78', 'earthsphere', 'Weather & Climate', 'Middle-school semester course — grades 7–8', 'Band B''s semester meteorology course: energy in the atmosphere, pressure and global circulation, storm systems, forecasting, and how weather becomes climate. Standards-aware, lab-light — the launchpad for the 9–12 lab-science track.', '7–8',
  8, 16900, 'Fall 2026', 'presale', '10526630084895', '/assets/art/es-blizzard.jpg',
  0, '2026-09-02', 30, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-climate-78', 1, 'The Atmosphere: Our Ocean of Air', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-climate-78', 2, 'Solar Energy & the Seasons', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-climate-78', 3, 'Pressure, Wind & Global Circulation', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-climate-78', 4, 'Water in the Air', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-climate-78', 5, 'Storm Systems & Fronts', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-climate-78', 6, 'Severe Weather Deep Dive', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-climate-78', 7, 'Forecasting: Radar, Satellites & Models', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-weather-climate-78', 8, 'From Weather to Climate + Review', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-severe-weather', 'earthsphere', 'Severe Weather & Forecasting', '0.5-credit elective — the on-air specialty', 'Tornadoes, supercells, hurricanes, blizzards, and the forecasting that saves lives — taught by the meteorologist who covers them on television. A half-credit high-school elective with real case studies from the anchor desk.', '9–12',
  8, 17900, 'Fall 2026', 'presale', '10526630117663', '/assets/art/es-hurricane-space.jpg',
  0.5, '2026-09-02', 40, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-severe-weather', 1, 'Anatomy of Severe Weather', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-severe-weather', 2, 'Thunderstorms & Lightning', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-severe-weather', 3, 'Tornadoes & Supercells', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-severe-weather', 4, 'Hurricanes & Tropical Systems', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-severe-weather', 5, 'Winter Storms, Ice & Blizzards', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-severe-weather', 6, 'Radar, Satellite & Warning Science', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-severe-weather', 7, 'Case Studies from the Anchor Desk', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-severe-weather', 8, 'Forecast Capstone + Exam', NULL, 35)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-meteorology-sem2', 'earthsphere', 'Meteorology: Lab Science — Semester 2', 'Severe weather, hurricanes, forecasting, climate, capstone weathercast', 'The second half of the flagship: thunderstorms and lightning, tornadoes and supercells, hurricanes, winter weather, forecasting with radar and models, climate systems, and the capstone — your student delivers a real weathercast. Completes the 1.0 lab-science credit.', '9–12',
  8, 19900, 'Coming January', 'presale', '10526630150431', '/assets/art/es-meteorology2.jpg',
  0.5, '2027-01-11', 50, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem2', 1, 'Thunderstorms & Lightning', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem2', 2, 'Tornadoes & Supercells', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem2', 3, 'Hurricanes & Tropical Systems', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem2', 4, 'Winter Weather & Hazards', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem2', 5, 'Forecasting: Radar, Satellite & Models', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem2', 6, 'Climate & Climate Systems', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem2', 7, 'Capstone Part 1: Applied Forecasting', NULL, 35)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-meteorology-sem2', 8, 'Capstone Part 2: Your Weathercast + Final Exam', NULL, 40)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-our-living-planet', 'earthsphere', 'Our Living Planet', 'Intro Earth Science for grades 5–6 — rocks, water, atmosphere', 'Band A''s earth-science companion to Weather Detectives: 8 project-driven units across rocks and landforms, water, and the atmosphere — designed to feel like a real step up from elementary science.', '5–6',
  8, 14900, 'Coming January', 'presale', '10526630183199', '/assets/art/es-living-planet.jpg',
  0, '2027-01-11', 60, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-our-living-planet', 1, 'Planet Earth: The Big Picture', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-our-living-planet', 2, 'Rocks, Minerals & Landforms', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-our-living-planet', 3, 'The Restless Ground: Quakes & Volcanoes', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-our-living-planet', 4, 'Water Shapes the World', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-our-living-planet', 5, 'Oceans & Coasts', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-our-living-planet', 6, 'The Atmosphere Above Us', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-our-living-planet', 7, 'Ecosystems & Earth''s Systems Together', NULL, 25)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-our-living-planet', 8, 'Explorer''s Capstone Project', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-earth-science-foundations-sem1', 'earthsphere', 'Earth Science Foundations — Semester 1', 'Full-year middle-school core — grades 7–8', 'Band B''s full-year core science, first semester: the geosphere and hydrosphere — plate tectonics, rocks and minerals, surface processes, and Earth''s water. Standards-aware and transcript-friendly for middle school records.', '7–8',
  8, 16900, 'Fall 2026', 'presale', '10526630215967', '/assets/art/es-atmosphere.jpg',
  0, '2026-09-02', 70, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem1', 1, 'Earth as a System', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem1', 2, 'Inside the Earth & Plate Tectonics', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem1', 3, 'Earthquakes & Volcanoes', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem1', 4, 'Rocks, Minerals & the Rock Cycle', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem1', 5, 'Weathering, Erosion & Landscapes', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem1', 6, 'Rivers, Lakes & Groundwater', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem1', 7, 'The Ocean System', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem1', 8, 'Semester Review & Exam', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-earth-science-foundations-sem2', 'earthsphere', 'Earth Science Foundations — Semester 2', 'Full-year middle-school core, second semester — grades 7–8', 'The second half of the full-year core: the atmosphere and weather, climate, the ocean-atmosphere connection, and Earth in space — the Moon, the solar system, and the stars. Completes the full-year middle-school science record.', '7–8',
  8, 16900, 'Coming January', 'presale', '10526885806367', '/assets/art/es-atmosphere.jpg',
  0, '2027-01-11', 75, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem2', 1, 'The Atmosphere & Weather Basics', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem2', 2, 'Storms & Severe Weather', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem2', 3, 'Climate & Climate Zones', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem2', 4, 'The Ocean–Atmosphere Connection', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem2', 5, 'Earth, Moon & Sun', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem2', 6, 'The Solar System', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem2', 7, 'Stars & Galaxies', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-science-foundations-sem2', 8, 'Semester Review & Exam', NULL, 35)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-dynamic-earth-78', 'earthsphere', 'Dynamic Earth', 'Semester course — plate tectonics, volcanoes, earthquakes, natural hazards', 'Band B''s hazards semester: why the ground shakes, why mountains explode, and how scientists monitor a restless planet. Grades 7–8.', '7–8',
  8, 16900, 'Coming January', 'presale', '10526630248735', '/assets/art/es-volcano.jpg',
  0, '2027-01-11', 80, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-dynamic-earth-78', 1, 'A Planet in Motion', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-dynamic-earth-78', 2, 'Plate Boundaries & What They Build', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-dynamic-earth-78', 3, 'Earthquakes & Seismic Waves', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-dynamic-earth-78', 4, 'Volcanoes: Types, Eruptions, Monitoring', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-dynamic-earth-78', 5, 'Tsunamis & Coastal Hazards', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-dynamic-earth-78', 6, 'Landslides, Floods & Wildfires', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-dynamic-earth-78', 7, 'Hazard Forecasting & Warning Systems', NULL, 28)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-dynamic-earth-78', 8, 'Hazard Capstone + Review', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-earth-space-sem1', 'earthsphere', 'Earth & Space Science — Semester 1', 'The required science credit — grades 9–12', 'The broad earth-science survey that satisfies a required science credit on most state graduation frameworks. First semester: geology, plate tectonics, Earth''s interior, rocks and minerals, and surface processes.', '9–12',
  8, 19900, 'Fall 2026', 'presale', '10526630314271', '/assets/art/es-earthspace.jpg',
  0.5, '2026-09-02', 90, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem1', 1, 'Earth''s Structure & Interior', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem1', 2, 'Plate Tectonics', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem1', 3, 'Earthquakes & Seismology', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem1', 4, 'Volcanism', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem1', 5, 'Rocks, Minerals & the Rock Cycle', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem1', 6, 'Weathering, Erosion & Soils', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem1', 7, 'Surface Water & Groundwater', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem1', 8, 'Geologic Time + Semester Exam', NULL, 35)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-earth-space-sem2', 'earthsphere', 'Earth & Space Science — Semester 2', 'The required science credit — grades 9–12', 'The second half of the survey: the atmosphere and weather, climate systems, the oceans, and astronomy — Earth-Moon-Sun mechanics, the solar system, stars, and galaxies. Completes the 1.0 credit with a final exam.', '9–12',
  8, 19900, 'Coming January', 'presale', '10526885839135', '/assets/art/es-earthspace.jpg',
  0.5, '2027-01-11', 95, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem2', 1, 'The Atmosphere & Energy', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem2', 2, 'Weather Systems & Forecasting', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem2', 3, 'Climate & Climate Change Science', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem2', 4, 'The World Ocean', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem2', 5, 'Earth, Moon & Sun', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem2', 6, 'The Solar System', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem2', 7, 'Stars, Galaxies & the Universe', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-earth-space-sem2', 8, 'Final Exam & Course Wrap', NULL, 35)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-oceanography', 'earthsphere', 'Oceanography', '0.5-credit elective — grades 9–12', 'Currents, waves, tides, marine geology, ocean-atmosphere interaction, and the sea''s role in weather and climate. A half-credit high-school elective.', '9–12',
  8, 17900, 'Coming January', 'presale', '10526630347039', '/assets/art/es-oceanography.jpg',
  0.5, '2027-01-11', 100, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-oceanography', 1, 'The World Ocean & Sea-Floor Geology', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-oceanography', 2, 'Seawater Chemistry & Structure', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-oceanography', 3, 'Currents & Global Circulation', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-oceanography', 4, 'Waves & Tides', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-oceanography', 5, 'Ocean Meets Atmosphere: El Niño & Hurricanes', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-oceanography', 6, 'Marine Life Zones', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-oceanography', 7, 'Coasts, Tsunamis & Hazards', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-oceanography', 8, 'Research Capstone + Exam', NULL, 35)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-natural-hazards', 'earthsphere', 'Natural Hazards & Geology', '0.5-credit elective — grades 9–12', 'Earthquakes, volcanoes, faults, landslides, floods, and the geology underneath them — plus how monitoring science turns hazards into warnings. A half-credit high-school elective.', '9–12',
  8, 17900, 'Coming January', 'presale', '10526630379807', '/assets/art/es-fault.jpg',
  0.5, '2027-01-11', 110, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-natural-hazards', 1, 'Reading the Land: Geology Fundamentals', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-natural-hazards', 2, 'Faults & Earthquake Mechanics', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-natural-hazards', 3, 'Volcanic Hazards & Monitoring', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-natural-hazards', 4, 'Mass Wasting: Landslides & Sinkholes', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-natural-hazards', 5, 'Flood Science & Floodplain Mapping', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-natural-hazards', 6, 'Risk, Vulnerability & Building Codes', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-natural-hazards', 7, 'Case Studies: When Warnings Worked', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-natural-hazards', 8, 'Hazard Assessment Capstone + Exam', NULL, 35)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;

INSERT INTO classes (id, school_id, title, subtitle, description, grade_band,
  lesson_count, price_cents, semester, status, shopify_product_id, hero_image,
  credit_value, cohort_start, sort_order, is_graduation_gift) VALUES (
  'es-climate-science', 'earthsphere', 'Climate Science & Environmental Systems', '0.5-credit elective — grades 9–12', 'Mechanisms, the carbon cycle, paleoclimate, observed data, and how climate modeling works — taught rigorously as science, without editorializing. A clearly-labeled half-credit elective.', '9–12',
  8, 17900, 'Coming January', 'presale', '10526630412575', '/assets/art/es-climate.jpg',
  0.5, '2027-01-11', 120, false)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  grade_band=EXCLUDED.grade_band, lesson_count=EXCLUDED.lesson_count, price_cents=EXCLUDED.price_cents,
  semester=EXCLUDED.semester, status=EXCLUDED.status, shopify_product_id=EXCLUDED.shopify_product_id,
  hero_image=EXCLUDED.hero_image, credit_value=EXCLUDED.credit_value, cohort_start=EXCLUDED.cohort_start,
  sort_order=EXCLUDED.sort_order, is_graduation_gift=EXCLUDED.is_graduation_gift;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-climate-science', 1, 'The Climate System & Energy Balance', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-climate-science', 2, 'The Carbon Cycle', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-climate-science', 3, 'Paleoclimate: Reading Ice & Rock', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-climate-science', 4, 'Observed Data: Instruments & Records', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-climate-science', 5, 'How Climate Models Work', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-climate-science', 6, 'Oceans, Ice & Feedback Loops', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-climate-science', 7, 'Environmental Systems & Resources', NULL, 30)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
INSERT INTO lessons (class_id, position, title, summary, duration_min) VALUES ('es-climate-science', 8, 'Data Analysis Capstone + Exam', NULL, 35)
ON CONFLICT (class_id, position) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, duration_min=EXCLUDED.duration_min;
