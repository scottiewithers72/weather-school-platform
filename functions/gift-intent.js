// POST /api/gift-intent { classId, fromName, recipientName, recipientEmail?, message?, deliverOn? }
// Saves the gift details privately and returns a Shopify checkout link that
// carries only an opaque gift_token (no names or emails in the URL).
import crypto from 'node:crypto';
import { sql } from './lib/db.js';
import { handle, ok, bad, parseBody } from './lib/http.js';
import { dateInZone } from './lib/core.js';

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const handler = handle(async (event) => {
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const b = parseBody(event);
  const recipientName = clean(b.recipientName, 60);
  const fromName = clean(b.fromName, 60);
  const recipientEmail = clean(b.recipientEmail, 120).toLowerCase();
  const message = String(b.message ?? '').trim().slice(0, 400);
  let deliverOn = clean(b.deliverOn, 10) || null;

  if (!recipientName) return bad("Add the recipient's name");
  if (!fromName) return bad('Add who the gift is from');
  if (recipientEmail && !EMAIL.test(recipientEmail)) return bad("That recipient email doesn't look right");
  if (!recipientEmail) deliverOn = null; // printed certificate only
  if (deliverOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deliverOn)) return bad('Pick a delivery date');
    const today = dateInZone(new Date());
    const max = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
    if (deliverOn < today) return bad('Delivery date is in the past');
    if (deliverOn > max) return bad('Pick a delivery date within the next 4 months');
    if (deliverOn === today) deliverOn = null; // send right after checkout
  }

  const db = sql();
  const [cls] = await db`SELECT id, semester, shopify_url, shopify_variant_id FROM classes WHERE id=${String(b.classId || '')}`;
  if (!cls) return bad('Pick a class');
  if (/^Coming/i.test(cls.semester || '') || !cls.shopify_variant_id) return bad('That class is not open for gifting yet');

  const token = crypto.randomBytes(12).toString('base64url');
  const viewKey = crypto.randomBytes(12).toString('base64url');
  await db`
    INSERT INTO gifts (token, view_key, class_id, from_name, recipient_name, recipient_email, message, deliver_on)
    VALUES (${token}, ${viewKey}, ${cls.id}, ${fromName}, ${recipientName}, ${recipientEmail || null},
            ${message || null}, ${deliverOn})`;

  const store = new URL(cls.shopify_url).origin; // e.g. https://shop.canetheweatherdog.com
  const checkoutUrl = `${store}/cart/${cls.shopify_variant_id}:1?attributes[gift_token]=${token}`;
  return ok({ checkoutUrl });
});
