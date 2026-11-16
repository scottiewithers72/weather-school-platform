// Transactional email via Resend (swap the fetch URL for Postmark if preferred).
import { sql } from './db.js';

// Each school sends from its own verified domain:
//   EMAIL_FROM_CANES="Cane's Weather School <hello@canesweatherschool.com>"
//   EMAIL_FROM_EARTHSPHERE="EarthSphere Academy <hello@earthsphereacademy.com>"
// Falls back to EMAIL_FROM until those are set.
export function fromAddress(school) {
  const key = school === 'earthsphere' ? 'EMAIL_FROM_EARTHSPHERE' : 'EMAIL_FROM_CANES';
  return process.env[key] || process.env.EMAIL_FROM;
}

export async function sendEmail({ to, subject, html, template, ref, school = 'canes' }) {
  const db = sql();
  // idempotency: never send the same template+ref twice
  if (ref) {
    const dup = await db`SELECT 1 FROM email_log WHERE template=${template} AND ref=${ref}`;
    if (dup.length) return { skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.EMAIL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: fromAddress(school), to, subject, html })
  });
  if (!res.ok) {
    console.error('Email send failed', await res.text());
    return { sent: false };
  }
  await db`INSERT INTO email_log (to_email, template, ref) VALUES (${to}, ${template}, ${ref || null})
           ON CONFLICT DO NOTHING`;
  return { sent: true };
}

export function codeDeliveryHtml({ schoolName, className, code, appUrl }) {
  const classroom = appUrl;                                   // e.g. https://canesweatherschool.com/classroom/
  const companion = appUrl.replace(/classroom\/?$/, 'app/');
  const appName = /earthsphere/i.test(appUrl) ? 'EarthSphere Study Companion' : "Cane's Class Companion";
  return `
  <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto">
    <h2>Welcome to ${schoolName}!</h2>
    <p>Your purchase of <strong>${className}</strong> is confirmed. Here is your class code:</p>
    <p style="font-size:22px;letter-spacing:2px;background:#f4f7fa;padding:14px 18px;
       border-radius:10px;text-align:center"><strong>${code}</strong></p>
    <h3 style="margin-bottom:4px">1. Open your Classroom</h3>
    <ol style="margin-top:4px">
      <li>Go to <a href="${classroom}">${classroom.replace('https://', '')}</a> on any computer, tablet or phone</li>
      <li>Create your family account — up to 4 student profiles</li>
      <li>Enter the code above. It works once and locks to your family.</li>
    </ol>
    <p>Each week a new lesson opens in the Classroom: the video, six printables, and the live office-hours link.
       Your first week opens the day you redeem (or on the class start date, if that's later).</p>
    <h3 style="margin-bottom:4px">2. Get the free ${appName} app</h3>
    <ol style="margin-top:4px">
      <li>On your child's phone or tablet, open <a href="${companion}">${companion.replace('https://', '')}</a></li>
      <li>Tap <em>Share → Add to Home Screen</em> (iPhone/iPad) or <em>Install</em> (Android)</li>
      <li>Sign in with the same email and password</li>
    </ol>
    <p>The app has every unlocked week's study guide, flash cards, quiz and game — and it works offline, in the car or anywhere.</p>
    <p>— Scott Withers</p>
  </div>`;
}

export function discountHtml({ schoolName, code, percent, expires, storeUrl }) {
  return `
  <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto">
    <h2>You've earned ${percent}% off your next class</h2>
    <p>Your family has been putting in real work at ${schoolName} — here's a thank-you:</p>
    <p style="font-size:22px;letter-spacing:2px;background:#f4f7fa;padding:14px 18px;
       border-radius:10px;text-align:center"><strong>${code}</strong></p>
    <p>Use it at <a href="${storeUrl}">${storeUrl}</a> before <strong>${expires}</strong>.
       One use, your family only.</p>
  </div>`;
}

export function graduationHtml({ giftClassName, academyUrl }) {
  return `
  <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto">
    <h2>🎓 Cane has a graduation gift!</h2>
    <p>Your student finished <strong>every Cane's Weather School class</strong>. That's a big deal.</p>
    <p>Cane's gift: <strong>${giftClassName}</strong> at EarthSphere Academy —
       <strong>free, already unlocked</strong> on your same family account.</p>
    <p>Sign in at <a href="${academyUrl}">${academyUrl}</a> with the same email and password.
       The kids' profiles come with you.</p>
  </div>`;
}

// ---------- Holiday gift emails ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SCHOOL = {
  canes: { name: "Cane's Weather School", site: 'https://canesweatherschool.com',
           art: 'https://canesweatherschool.com/assets/art/canes-snow.jpg', color: '#B3262E', sign: 'Scott & Cane 🐾' },
  earthsphere: { name: 'EarthSphere Academy', site: 'https://earthsphereacademy.com',
           art: 'https://earthsphereacademy.com/assets/art/es-blizzard.jpg', color: '#0B3D54', sign: 'Scott Withers' }
};
export const schoolInfo = (id) => SCHOOL[id] || SCHOOL.canes;
const fmtDate = (d) => new Date(String(d).slice(0, 10) + 'T12:00:00Z')
  .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

function giftShell(school, inner) {
  const s = schoolInfo(school);
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:580px;margin:auto;background:#fff">
    <img src="${s.art}" alt="" width="580" style="width:100%;border-radius:14px 14px 0 0;display:block">
    <div style="border:3px solid ${s.color};border-top:0;border-radius:0 0 14px 14px;padding:24px 26px">
      ${inner}
      <p style="margin-top:22px">— ${s.sign}</p>
    </div>
  </div>`;
}

// To the buyer, right after checkout.
export function giftPurchaserHtml({ school, className, recipientName, recipientEmail, deliverOn, code, certUrl }) {
  const plan = recipientEmail
    ? (deliverOn
        ? `We'll email the gift to <strong>${esc(recipientName)}</strong> on <strong>${fmtDate(deliverOn)}</strong> at 7&nbsp;am Eastern — and let you know when it's delivered.`
        : `We just emailed the gift to <strong>${esc(recipientName)}</strong>.`)
    : `Print the certificate below and give it to <strong>${esc(recipientName)}</strong> in person.`;
  return giftShell(school, `
    <h2 style="margin:0 0 8px">🎁 Your gift is ready!</h2>
    <p>You gave <strong>${esc(className)}</strong> to <strong>${esc(recipientName)}</strong>. ${plan}</p>
    <p style="text-align:center;margin:22px 0">
      <a href="${certUrl}" style="background:#FFB627;color:#0E3A5D;font-weight:800;padding:14px 26px;border-radius:99px;text-decoration:none">
        Open &amp; print the gift certificate</a></p>
    <p style="font-size:13px;color:#5b7384">Gift code (keep this private — it works once):
      <strong style="letter-spacing:1px">${esc(code)}</strong></p>`);
}

// To the recipient, on the delivery date.
export function giftRecipientHtml({ school, className, fromName, recipientName, message, code, cohortStart, certUrl }) {
  const s = schoolInfo(school);
  return giftShell(school, `
    <h2 style="margin:0 0 8px">🎄 ${esc(recipientName)}, you've got a gift!</h2>
    <p><strong>${esc(fromName || 'Someone special')}</strong> gave your family
       <strong>${esc(className)}</strong> from ${s.name}.</p>
    ${message ? `<blockquote style="margin:16px 0;padding:12px 16px;background:#FFF6E0;border-left:4px solid #FFB627;border-radius:8px;font-style:italic">${esc(message)}</blockquote>` : ''}
    ${cohortStart ? `<p>Class begins <strong>${fmtDate(cohortStart)}</strong> — one new lesson every week.</p>` : ''}
    <p style="font-size:22px;letter-spacing:2px;background:#f4f7fa;padding:14px 18px;border-radius:10px;text-align:center"><strong>${esc(code)}</strong></p>
    <ol>
      <li>Open <a href="${s.site}/classroom/">${s.site.replace('https://', '')}/classroom</a> on a phone, tablet or computer</li>
      <li>Create your free family account (up to 4 student profiles)</li>
      <li>Enter the code above — it unlocks the class for your whole family</li>
    </ol>
    <p><a href="${certUrl}">View your printable gift certificate</a></p>`);
}

// Back to the buyer once the scheduled email goes out.
export function giftDeliveredHtml({ school, className, recipientName }) {
  return giftShell(school, `
    <h2 style="margin:0 0 8px">✅ Gift delivered</h2>
    <p>We just emailed <strong>${esc(className)}</strong> to <strong>${esc(recipientName)}</strong>, right on schedule.
       Thank you for giving the gift of science!</p>`);
}
