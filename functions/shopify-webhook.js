// POST /api/shopify-webhook  (orders/paid)
// Verifies HMAC, maps line items -> classes, generates single-use access
// codes, emails them with install instructions. Idempotent per order.
import { sql } from './lib/db.js';
import { handle, ok, bad } from './lib/http.js';
import { verifyShopifyWebhook } from './lib/shopify.js';
import { generateAccessCode } from './lib/core.js';
import { sendEmail, codeDeliveryHtml } from './lib/email.js';

export const handler = handle(async (event) => {
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const hmac = event.headers['x-shopify-hmac-sha256'] || event.headers['X-Shopify-Hmac-Sha256'];
  if (!verifyShopifyWebhook(event.body, hmac)) return bad('Invalid webhook signature', 401);

  const order = JSON.parse(event.body);
  const db = sql();
  const email = order.email || order.customer?.email;
  if (!email) return ok({ skipped: 'no email on order' });

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
      const schoolName = cls.school_id === 'canes' ? "Cane's Weather School" : 'EarthSphere Academy';
      const appUrl = cls.school_id === 'canes'
        ? 'https://canesweatherschool.com/app/'
        : 'https://earthsphereacademy.com/app/';
      await sendEmail({
        to: email,
        subject: `Your ${cls.title} access code (app included!)`,
        html: codeDeliveryHtml({ schoolName, className: cls.title, code, appUrl }),
        template: 'code_delivery',
        ref
      });
      results.push({ class: cls.id, code });
    }
  }
  return ok({ delivered: results.length });
});
