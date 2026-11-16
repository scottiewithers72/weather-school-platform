// Shared gift helpers: delivery is used by both the webhook (deliver now)
// and the hourly scheduler (deliver on the chosen date).
import { sendEmail, giftRecipientHtml, giftDeliveredHtml, schoolInfo } from './email.js';

export const certUrl = (g, schoolId) =>
  `${schoolInfo(schoolId).site}/gift/certificate.html?g=${encodeURIComponent(g.token)}&k=${encodeURIComponent(g.view_key)}`;

// Atomically claims a paid gift (paid -> delivered) so it is sent exactly once,
// even if two schedulers or a webhook retry run at the same moment.
export async function deliverGift(db, giftId) {
  const [g] = await db`
    UPDATE gifts SET status='delivered', delivered_at=now()
    WHERE id=${giftId} AND status='paid' AND recipient_email IS NOT NULL
    RETURNING *`;
  if (!g) return { delivered: false };
  const [cls] = await db`SELECT title, school_id, cohort_start FROM classes WHERE id=${g.class_id}`;
  const school = cls.school_id;
  const sent = await sendEmail({
    school, to: g.recipient_email,
    subject: `🎁 ${g.from_name || 'Someone special'} sent you a gift: ${cls.title}`,
    html: giftRecipientHtml({ school, className: cls.title, fromName: g.from_name,
      recipientName: g.recipient_name, message: g.message, code: g.code,
      cohortStart: cls.cohort_start && new Date(cls.cohort_start).toISOString().slice(0, 10),
      certUrl: certUrl(g, school) }),
    template: 'gift_recipient', ref: `gift-${g.id}`
  });
  if (!sent.sent) {
    // put it back so the next run retries
    await db`UPDATE gifts SET status='paid', delivered_at=NULL WHERE id=${g.id}`;
    return { delivered: false, error: 'send failed' };
  }
  if (g.purchaser_email && g.deliver_on) {
    await sendEmail({
      school, to: g.purchaser_email, subject: `Your gift to ${g.recipient_name} was delivered`,
      html: giftDeliveredHtml({ school, className: cls.title, recipientName: g.recipient_name }),
      template: 'gift_delivered', ref: `gift-${g.id}`
    });
  }
  return { delivered: true };
}
