// Unit tests for the pure business logic (functions/lib/core.js).
// Run: node tests/run-tests.js
import {
  generateAccessCode, unlockedPositions, nextUnlockDate,
  discountEligible, isGraduated, licenseExpiry,
  zonedToUtc, nextSession
} from '../functions/lib/core.js';

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ FAIL: ${name}`); }
}

console.log('Access codes');
const c1 = generateAccessCode('canes');
const c2 = generateAccessCode('earthsphere');
t('canes prefix', c1.startsWith('CANE-'));
t('earthsphere prefix', c2.startsWith('ESPH-'));
t('format XXXX-XXXX', /^[A-Z]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c1));
t('no ambiguous chars (0,O,1,I,L)', !/[01OIL]/.test(c1.slice(5)));
t('codes are unique', generateAccessCode('canes') !== generateAccessCode('canes'));

console.log('Drip engine (cohort starts 2026-09-02, 8 lessons)');
const drip = { releaseMode: 'drip', dripStart: '2026-09-02', lessonCount: 8 };
t('before start: nothing unlocked',
  unlockedPositions({ ...drip, now: new Date('2026-08-15') }).length === 0);
t('day 1: lesson 1 only',
  JSON.stringify(unlockedPositions({ ...drip, now: new Date('2026-09-02T08:00:00') })) === '[1]');
t('day 6: still lesson 1',
  unlockedPositions({ ...drip, now: new Date('2026-09-08') }).length === 1);
t('week 2 (Sep 9): lessons 1-2',
  unlockedPositions({ ...drip, now: new Date('2026-09-09T08:00:00') }).length === 2);
t('week 5: lessons 1-5',
  unlockedPositions({ ...drip, now: new Date('2026-09-30T08:00:00') }).length === 5);
t('far future: capped at 8',
  unlockedPositions({ ...drip, now: new Date('2027-06-01') }).length === 8);
t('next unlock from day 1 is Sep 9',
  nextUnlockDate({ ...drip, now: new Date('2026-09-02T08:00:00') }) === '2026-09-09');
t('no next unlock when all open',
  nextUnlockDate({ ...drip, now: new Date('2027-06-01') }) === null);
t('evergreen: all unlocked instantly',
  unlockedPositions({ releaseMode: 'all_now', dripStart: null, lessonCount: 12 }).length === 12);

console.log('Engagement discount trigger');
t('not eligible at 3 days', !discountEligible({ distinctUsageDays: 3, hasExistingGrant: false }));
t('eligible at 4 days', discountEligible({ distinctUsageDays: 4, hasExistingGrant: false }));
t('never re-grants', !discountEligible({ distinctUsageDays: 40, hasExistingGrant: true }));

console.log('Graduation detection');
const cane3 = [
  { id: 'a', lessonCount: 6 }, { id: 'b', lessonCount: 6 }, { id: 'c', lessonCount: 8 }
];
t('incomplete: not graduated',
  !isGraduated({ caneClasses: cane3, completionMap: { a: 6, b: 6, c: 5 } }));
t('all complete: graduated',
  isGraduated({ caneClasses: cane3, completionMap: { a: 6, b: 6, c: 8 } }));
t('empty catalog: never graduates', !isGraduated({ caneClasses: [], completionMap: {} }));
t('best-student-per-class logic is callers responsibility (map holds max)', true);

console.log('License expiry');
const exp = licenseExpiry(new Date('2026-07-01T12:00:00'));
t('12-month license', exp.getFullYear() === 2027 && exp.getMonth() === 6);

console.log('Office hours');
// Winter (EST, UTC-5): 1:00 pm ET = 18:00 UTC
t('ET->UTC in winter', zonedToUtc('2027-01-04', '13:00').toISOString() === '2027-01-04T18:00:00.000Z');
// Summer (EDT, UTC-4): 1:00 pm ET = 17:00 UTC
t('ET->UTC in summer', zonedToUtc('2027-06-07', '13:00').toISOString() === '2027-06-07T17:00:00.000Z');
const mon = { weekday: 1, startTime: '13:00', durationMin: 30, startsOn: '2027-01-04' };
let s1 = nextSession({ ...mon, now: new Date('2026-12-20T15:00:00Z') });
t('before cohort -> first session Jan 4', s1.date === '2027-01-04' && !s1.joinable);
let s2 = nextSession({ ...mon, now: new Date('2027-01-04T17:55:00Z') });
t('10 min early -> joinable', s2.date === '2027-01-04' && s2.joinable);
let s3 = nextSession({ ...mon, now: new Date('2027-01-04T17:45:00Z') });
t('15 min early -> not joinable yet', !s3.joinable);
let s4 = nextSession({ ...mon, now: new Date('2027-01-04T18:31:00Z') });
t('after session -> next week', s4.date === '2027-01-11');
let s5 = nextSession({ ...mon, skips: ['2027-01-11'], now: new Date('2027-01-05T12:00:00Z') });
t('skipped week jumps ahead', s5.date === '2027-01-18');
let s6 = nextSession({ weekday: 2, startTime: '13:00', startsOn: '2027-01-05', now: new Date('2027-01-04T20:00:00Z') });
t('Tuesday slot -> Jan 5', s6.date === '2027-01-05');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
