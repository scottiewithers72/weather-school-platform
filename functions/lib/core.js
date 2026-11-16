// Pure business logic — no I/O. Fully unit-testable (see tests/).
import crypto from 'node:crypto';

// ---------- Access codes ----------
// Format: CANE-7G2K-Q9XD / ESPH-XXXX-XXXX. No 0/O/1/I (phone-readable).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function generateAccessCode(schoolId) {
  const prefix = schoolId === 'canes' ? 'CANE' : 'ESPH';
  const block = () =>
    Array.from(crypto.randomBytes(4))
      .map((b) => ALPHABET[b % ALPHABET.length])
      .join('');
  return `${prefix}-${block()}-${block()}`;
}

// ---------- Drip engine ----------
// Given an enrollment and a lesson position, is the lesson unlocked *now*?
// release_mode 'all_now'  -> everything unlocked (evergreen).
// release_mode 'drip'     -> lesson N unlocks (N-1) weeks after drip_start.
export function unlockedPositions({ releaseMode, dripStart, lessonCount, now = new Date() }) {
  if (releaseMode === 'all_now') {
    return Array.from({ length: lessonCount }, (_, i) => i + 1);
  }
  // Calendar days in Eastern time, so a new week opens at midnight ET.
  const days = daysBetween(dripStart, dateInZone(now));
  if (days < 0) return [];
  const unlocked = Math.min(Math.floor(days / 7) + 1, lessonCount);
  return Array.from({ length: unlocked }, (_, i) => i + 1);
}

export function nextUnlockDate({ releaseMode, dripStart, lessonCount, now = new Date() }) {
  if (releaseMode === 'all_now') return null;
  const open = unlockedPositions({ releaseMode, dripStart, lessonCount, now }).length;
  if (open >= lessonCount) return null;
  return addDays(dripStart, open * 7);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
}

// ---------- Engagement discount trigger ----------
// Fires when a family has used the app on >= minDays distinct days,
// and has no existing grant.
export function discountEligible({ distinctUsageDays, hasExistingGrant, minDays = 4 }) {
  return !hasExistingGrant && distinctUsageDays >= minDays;
}

// ---------- Graduation detection ----------
// A family graduates when, for EVERY live Cane's class, at least one
// student profile has completed every lesson (video done + quiz passed
// where the lesson has a quiz).
export function isGraduated({ caneClasses, completionMap }) {
  if (!caneClasses.length) return false;
  return caneClasses.every((c) => {
    const done = completionMap[c.id] || 0;
    return done >= c.lessonCount;
  });
}

// 12-month family license expiry
export function licenseExpiry(from = new Date()) {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

// ---------- Office hours (weekly Zoom Q&A) ----------
// Schedules are stored in Eastern time ("HH:MM", weekday 0=Sun..6=Sat).
// Convert a wall-clock time in a time zone to a UTC Date (DST-safe).
function tzOffsetMs(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - ms;
}
export function zonedToUtc(dateStr, timeStr, tz = 'America/New_York') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz); // second pass handles DST boundaries
  return new Date(t);
}
// Rolling enrollment: a family's Week 1 opens on the later of the class's
// first-cohort date and the day they redeem (Eastern time). Weeks then unlock
// every 7 days from that personal start date.
export function personalDripStart(cohortStart, now = new Date()) {
  const today = dateInZone(now);
  if (!cohortStart) return today;
  return cohortStart > today ? cohortStart : today;
}

export function dateInZone(now, tz = 'America/New_York') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now); // YYYY-MM-DD
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Next (or current) session for a weekly slot, honoring the first-session date
// and any skipped weeks. Returns { start, end, joinable } or null.
// joinable = the Join button window: 10 minutes before start until the end.
export function nextSession({ weekday, startTime, durationMin = 30, startsOn = null,
                              skips = [], now = new Date(), tz = 'America/New_York',
                              earlyMin = 10 }) {
  const skipSet = new Set(skips);
  let base = dateInZone(now, tz);
  if (startsOn && startsOn > base) base = startsOn;
  for (let i = 0; i < 70; i++) {
    const day = addDays(base, i);
    if (new Date(day + 'T12:00:00Z').getUTCDay() !== weekday) continue;
    if (skipSet.has(day)) continue;
    const start = zonedToUtc(day, startTime, tz);
    const end = new Date(start.getTime() + durationMin * 60000);
    if (end <= now) continue;
    const joinable = now >= new Date(start.getTime() - earlyMin * 60000) && now < end;
    return { date: day, start, end, joinable };
  }
  return null;
}
