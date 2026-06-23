// Shopify Admin API helpers: webhook verification + real single-use discount codes.
import crypto from 'node:crypto';

export function verifyShopifyWebhook(rawBody, hmacHeader) {
  const digest = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader || ''));
  } catch { return false; }
}

const API = () =>
  `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-04`;

async function shopifyFetch(path, opts = {}) {
  const res = await fetch(`${API()}${path}`, {
    ...opts,
    headers: {
      'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Shopify ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

// Creates a price rule + single discount code, single-use, expires in `days`.
export async function createSingleUseDiscount({ code, percent = 15, days = 45 }) {
  const now = new Date();
  const ends = new Date(now.getTime() + days * 864e5);
  const { price_rule } = await shopifyFetch('/price_rules.json', {
    method: 'POST',
    body: JSON.stringify({
      price_rule: {
        title: `ENGAGED-${code}`,
        target_type: 'line_item',
        target_selection: 'all',
        allocation_method: 'across',
        value_type: 'percentage',
        value: `-${percent}.0`,
        customer_selection: 'all',
        usage_limit: 1,
        once_per_customer: true,
        starts_at: now.toISOString(),
        ends_at: ends.toISOString()
      }
    })
  });
  await shopifyFetch(`/price_rules/${price_rule.id}/discount_codes.json`, {
    method: 'POST',
    body: JSON.stringify({ discount_code: { code } })
  });
  return { code, percent, expiresAt: ends.toISOString() };
}
