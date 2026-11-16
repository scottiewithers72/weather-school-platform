-- Holiday gifting: "Give a class as a gift"
ALTER TABLE classes ADD COLUMN IF NOT EXISTS shopify_variant_id TEXT;
UPDATE classes SET shopify_variant_id = CASE shopify_product_id
    WHEN '10526629691679' THEN '52612974313759'
    WHEN '10526629724447' THEN '52612974346527'
    WHEN '10526629822751' THEN '52612974969119'
    WHEN '10526629855519' THEN '52612975001887'
    WHEN '10526629921055' THEN '52612975067423'
    WHEN '10526629953823' THEN '52612975100191'
    WHEN '10526629986591' THEN '52612975132959'
    WHEN '10526630019359' THEN '52612975165727'
    WHEN '10526630052127' THEN '52612975198495'
    WHEN '10526630084895' THEN '52612975231263'
    WHEN '10526630117663' THEN '52612975264031'
    WHEN '10526630150431' THEN '52612975296799'
    WHEN '10526630183199' THEN '52612975329567'
    WHEN '10526630215967' THEN '52612975362335'
    WHEN '10526885806367' THEN '52613828477215'
    WHEN '10526630248735' THEN '52612975395103'
    WHEN '10526630314271' THEN '52612975460639'
    WHEN '10526885839135' THEN '52613828509983'
    WHEN '10526630347039' THEN '52612975493407'
    WHEN '10526630379807' THEN '52612975526175'
    WHEN '10526630412575' THEN '52612975558943'
  END
WHERE shopify_variant_id IS NULL;

CREATE TABLE IF NOT EXISTS gifts (
  id              SERIAL PRIMARY KEY,
  token           TEXT UNIQUE NOT NULL,   -- rides through checkout as the gift_token cart attribute
  view_key        TEXT NOT NULL,          -- secret for the printable certificate link
  class_id        TEXT NOT NULL REFERENCES classes(id),
  from_name       TEXT,
  recipient_name  TEXT NOT NULL,
  recipient_email TEXT,                   -- optional: if set, we email the gift on deliver_on
  message         TEXT,
  deliver_on      DATE,                   -- Eastern calendar date; NULL = deliver at purchase
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','delivered')),
  order_id        TEXT,
  purchaser_email TEXT,
  code            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS gifts_due ON gifts (status, deliver_on);
