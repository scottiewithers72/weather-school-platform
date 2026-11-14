-- Weekly live Zoom office hours. Times are Eastern ("HH:MM"), weekday 0=Sun..6=Sat.
-- class_id NULL = one shared slot for every class in that school (Cane's).
CREATE TABLE IF NOT EXISTS office_hours (
  id           SERIAL PRIMARY KEY,
  school_id    TEXT NOT NULL CHECK (school_id IN ('canes','earthsphere')),
  class_id     TEXT REFERENCES classes(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  weekday      INT  NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time   TEXT NOT NULL,
  duration_min INT  NOT NULL DEFAULT 30,
  starts_on    DATE,
  zoom_url     TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS office_hours_skips (
  office_hour_id INT  NOT NULL REFERENCES office_hours(id) ON DELETE CASCADE,
  skip_date      DATE NOT NULL,
  PRIMARY KEY (office_hour_id, skip_date)
);

-- Winter 2027 schedule (1:00 pm ET start). Zoom links are pasted in via the admin panel.
INSERT INTO office_hours (school_id, class_id, label, weekday, start_time, starts_on, active, sort_order)
SELECT * FROM (VALUES
  ('canes',       NULL,                                'Ask Scott & Cane — all Cane''s classes', 1, '13:00', DATE '2027-01-04', true,  10),
  ('earthsphere', 'es-meteorology-sem1',               'Meteorology Sem. 1 office hours',        1, '13:30', DATE '2027-01-04', true,  20),
  ('earthsphere', 'es-earth-space-sem1',               'Earth & Space Science Sem. 1 office hours', 1, '14:00', DATE '2027-01-04', true, 30),
  ('earthsphere', 'es-severe-weather',                 'Severe Weather & Forecasting office hours', 2, '13:00', DATE '2027-01-05', true, 40),
  ('earthsphere', 'es-weather-climate-78',             'Weather & Climate office hours',         2, '13:30', DATE '2027-01-05', true,  50),
  ('earthsphere', 'es-earth-science-foundations-sem1', 'Earth Science Foundations Sem. 1 office hours', 2, '14:00', DATE '2027-01-05', true, 60),
  ('earthsphere', 'es-weather-detectives',             'Weather Detectives office hours',        2, '14:30', DATE '2027-01-05', false, 70)
) AS v(school_id, class_id, label, weekday, start_time, starts_on, active, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM office_hours);
