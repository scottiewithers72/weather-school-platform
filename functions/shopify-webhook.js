// POST /api/shopify-webhook  (orders/paid)
// Verifies HMAC, maps line items -> classes, generates single-use access
// codes, emails them with install instructions. Idempotent per order.
import { sql } from './lib/db.js';
import { handle, ok, bad } from './lib/http.js';
import { verifyShopifyWebhook } from './lib/shopify.js';
import { generateAccessCode } from './lib/core.js';
import { sendEmail, codeDeliveryHtml, giftPurchaserHtml } from './lib/email.js';
import { deliverGift, certUrl } from './lib/gifts.js';

export const handler = handle(async (event) => {
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const hmac = event.headers['x-shopify-hmac-sha256'] || event.headers['X-Shopify-Hmac-Sha256'];
  if (!verifyShopifyWebhook(event.body, hmac)) return bad('Invalid webhook signature', 401);

  const order = JSON.parse(event.body);
  const db = sql();
  const email = order.email || order.customer?.email;
  if (!email) return ok({ skipped: 'no email on order' });

  // Holiday gifts: the gift form sends checkout a private gift_token cart attribute.
  const giftToken = (order.note_attributes || []).find((a) => a.name === 'gift_token')?.value || null;
  let giftUsed = false;

  const results = [];
  for (const item of order.line_items || []) {
    const [cls] = await db`
      SELECT * FROM classes WHERE shopify_product_id=${String(item.product_id)}`;
    if (!cls) continue; // not a class product (merch etc.)

    for (let q = 0; q < (item.quantity || 1); q++) {
      // idempotency: one code per order+product+seq
      const ref = `${order.id}:${item.product_id}:${q}`;
      const existing = await db`
        SELECT code FROM access_codes WHERE order_id=${String(order.id)} AND class_id=${cls.id}
        OFFSET ${q} LIMIT 1`;
      let code = existing[0]?.code;
      if (!code) {
        code = generateAccessCode(cls.school_id);
        await db`
          INSERT INTO access_codes (code, class_id, order_id, order_email)
          VALUES (${code}, ${cls.id}, ${String(order.id)}, ${email})`;
      }
      // First matching unit of a gift order becomes the gift.
      if (giftToken && !giftUsed) {
        const [gift] = await db`
          UPDATE gifts SET status='paid', paid_at=now(), code=${code},
                 order_id=${String(order.id)}, purchaser_email=${email}
          WHERE token=${giftToken} AND class_id=${cls.id} AND status='pending'
          RETURNING *`;
        const [already] = gift ? [null] : await db`
          SELECT id FROM gifts WHERE token=${giftToken} AND order_id=${String(order.id)}`;
        if (gift || already) {
          giftUsed = true;
          if (gift) {
            await sendEmail({
              school: cls.school_id, to: email,
              subject: `🎁 Your gift of ${cls.title} is ready`,
              html: giftPurchaserHtml({ school: cls.school_id, className: cls.title,
                recipientName: gift.recipient_name, recipientEmail: gift.recipient_email,
                deliverOn: gift.deliver_on && new Date(gift.deliver_on).toISOString().slice(0, 10),
                code, certUrl: certUrl(gift, cls.school_id) }),
              template: 'gift_purchaser', ref: `gift-${gift.id}`
            });
            if (gift.recipient_email && !gift.deliver_on) await deliverGift(db, gift.id);
          }
          results.push({ class: cls.id, code, gift: true });
          continue;
        }
      }
      const schoolName = cls.school_id === 'canes' ? "Cane's Weather School" : 'EarthSphere Academy';
      const appUrl = cls.school_id === 'canes'
        ? 'https://canesweatherschool.com/app/'
        : 'https://earthsphereacademy.com/app/';
      await sendEmail({
        to: email,
        subject: `Your ${cls.title} access code (app included!)`,
        html: codeDeliveryHtml({ schoolName, className: cls.title, code, appUrl }),
        template: 'code_delivery',
        ref,
        school: cls.school_id
      });
      results.push({ class: cls.id, code });
    }
  }
  return ok({ delivered: results.length });
});
