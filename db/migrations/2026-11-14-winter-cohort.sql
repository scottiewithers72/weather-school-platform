-- Retarget to the Jan 4, 2027 cohort.
UPDATE classes SET semester='Winter 2027', cohort_start=DATE '2027-01-04' WHERE semester='Fall 2026';
UPDATE classes SET semester='Coming Spring 2027', cohort_start=NULL WHERE semester='Coming January';
-- Emmy credit standard
UPDATE classes SET
  description = replace(replace(replace(replace(description,
    'a four-time Emmy-winning broadcast meteorologist', 'a broadcast meteorologist and Four-Time National Emmy Award Winner'),
    'a real four-time Emmy-winning TV meteorologist', 'a real TV meteorologist and Four-Time National Emmy Award Winner'),
    'a four-time Emmy-winning meteorologist', 'a meteorologist and Four-Time National Emmy Award Winner'),
    'Emmy-winning', 'Four-Time National Emmy Award Winner'),
  subtitle = replace(subtitle, 'Emmy-winning', 'Four-Time National Emmy Award Winner')
WHERE description ILIKE '%emmy%' OR subtitle ILIKE '%emmy%';
