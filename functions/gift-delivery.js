// Scheduled hourly (see netlify.toml): emails gifts whose delivery date has
// arrived, from 7 am Eastern on. Runs only on the Cane's site so the two sites
// don't both work the queue (delivery is also claimed atomically).
import { sql } from './lib/db.js';
import { deliverGift } from './lib/gifts.js';
import { dateInZone } from './lib/core.js';

export const handler = async () => {
  if ((process.env.SCHOOL_ID || 'canes') !== 'canes') return { statusCode: 200, body: 'skip' };
  const now = new Date();
  const hourET = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(now));
  if (hourET < 7) return { statusCode: 200, body: 'before 7am ET' };
  const today = dateInZone(now);
  const db = sql();
  const due = await db`
    SELECT id FROM gifts
    WHERE status='paid' AND recipient_email IS NOT NULL AND deliver_on IS NOT NULL AND deliver_on <= ${today}
    ORDER BY deliver_on LIMIT 200`;
  let delivered = 0;
  for (const g of due) {
    try { if ((await deliverGift(db, g.id)).delivered) delivered++; }
    catch (e) { console.error('gift delivery failed', g.id, e); }
  }
  console.log(`gift-delivery: ${delivered}/${due.length} delivered`);
  return { statusCode: 200, body: JSON.stringify({ delivered, due: due.length }) };
};
