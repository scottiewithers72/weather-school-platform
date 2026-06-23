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
  const start = new Date(dripStart + 'T00:00:00');
  if (now < start) return [];
  const weeksElapsed = Math.floor((now - start) / (7 * 864e5));
  const unlocked = Math.min(weeksElapsed + 1, lessonCount);
  return Array.from({ length: unlocked }, (_, i) => i + 1);
}

export function nextUnlockDate({ releaseMode, dripStart, lessonCount, now = new Date() }) {
  if (releaseMode === 'all_now') return null;
  const open = unlockedPositions({ releaseMode, dripStart, lessonCount, now }).length;
  if (open >= lessonCount) return null;
  const start = new Date(dripStart + 'T00:00:00');
  const next = new Date(start.getTime() + open * 7 * 864e5);
  return next.toISOString().slice(0, 10);
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
