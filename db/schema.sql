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
