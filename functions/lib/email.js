// Transactional email via Resend (swap the fetch URL for Postmark if preferred).
import { sql } from './db.js';

export async function sendEmail({ to, subject, html, template, ref }) {
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
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, html })
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
  return `
  <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto">
    <h2>Welcome to ${schoolName}!</h2>
    <p>Your purchase of <strong>${className}</strong> is confirmed — and it includes the
       companion app (a $29 value, included free).</p>
    <p style="font-size:22px;letter-spacing:2px;background:#f4f7fa;padding:14px 18px;
       border-radius:10px;text-align:center"><strong>${code}</strong></p>
    <ol>
      <li>Open <a href="${appUrl}">${appUrl}</a> on your phone or tablet</li>
      <li>Tap <em>Add to Home Screen</em> when prompted (that installs the app)</li>
      <li>Create your family account — up to 4 student profiles</li>
      <li>Enter the code above. It works once and locks to your family.</li>
    </ol>
    <p>Lessons stream inside the app — nothing to download.</p>
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
