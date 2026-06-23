#!/bin/bash
# =====================================================================
# Weather School Platform — full two-site deploy (run when network is up)
# Build once, deploy twice. Functions are bundled by Netlify (esbuild).
#
# Prereq (one time): a Netlify personal access token in NETLIFY_AUTH_TOKEN.
#   export NETLIFY_AUTH_TOKEN=xxxxx   (User settings -> Applications -> New token)
#
# Secrets are passed via env at run time — NEVER hard-coded in this file.
# Required env when running:
#   DATABASE_URL, EMAIL_API_KEY, JWT_SECRET, ADMIN_PASSWORD
# Optional now / fill later (Shopify webhook + Bunny tasks):
#   SHOPIFY_WEBHOOK_SECRET, SHOPIFY_ADMIN_TOKEN, SHOPIFY_STORE_DOMAIN,
#   BUNNY_LIBRARY_ID, BUNNY_TOKEN_KEY
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

: "${NETLIFY_AUTH_TOKEN:?set NETLIFY_AUTH_TOKEN}"
: "${DATABASE_URL:?set DATABASE_URL}"
: "${EMAIL_API_KEY:?set EMAIL_API_KEY}"
: "${JWT_SECRET:?set JWT_SECRET (e.g. openssl rand -hex 32)}"
: "${ADMIN_PASSWORD:?set ADMIN_PASSWORD}"

NETLIFY="npx -y netlify-cli@17"

deploy_site () {
  SCHOOL_ID="$1"; SITE_NAME="$2"; PUBLISH="sites/$1"
  echo "=== Deploying $SITE_NAME ($SCHOOL_ID) ==="

  # Create the site if it doesn't exist (idempotent: ignore error if present)
  $NETLIFY sites:create --name "$SITE_NAME" --manual 2>/dev/null || true
  SITE_ID="$($NETLIFY sites:list --json | node -e "let s=JSON.parse(require('fs').readFileSync(0));let m=s.find(x=>x.name==='$SITE_NAME');process.stdout.write(m?m.site_id:'')")"
  echo "site_id=$SITE_ID"

  # Env vars (shared + per-site SCHOOL_ID + EMAIL_FROM)
  EMAIL_FROM="hello@${SITE_NAME}.com"
  for kv in \
    "SCHOOL_ID=$SCHOOL_ID" \
    "DATABASE_URL=$DATABASE_URL" \
    "JWT_SECRET=$JWT_SECRET" \
    "EMAIL_API_KEY=$EMAIL_API_KEY" \
    "EMAIL_FROM=$EMAIL_FROM" \
    "ADMIN_PASSWORD=$ADMIN_PASSWORD" \
    "SHOPIFY_WEBHOOK_SECRET=${SHOPIFY_WEBHOOK_SECRET:-}" \
    "SHOPIFY_ADMIN_TOKEN=${SHOPIFY_ADMIN_TOKEN:-}" \
    "SHOPIFY_STORE_DOMAIN=${SHOPIFY_STORE_DOMAIN:-}" \
    "BUNNY_LIBRARY_ID=${BUNNY_LIBRARY_ID:-}" \
    "BUNNY_TOKEN_KEY=${BUNNY_TOKEN_KEY:-}" ; do
      K="${kv%%=*}"; V="${kv#*=}"
      [ -n "$V" ] && $NETLIFY env:set "$K" "$V" --site "$SITE_ID" >/dev/null || true
  done

  # Build + deploy to production. publish dir per site; functions shared.
  $NETLIFY deploy --site "$SITE_ID" --prod --build \
    --dir "$PUBLISH" --functions functions
  echo "=== $SITE_NAME deployed ==="
}

deploy_site "canes"       "canesweatherschool"
deploy_site "earthsphere" "earthsphereacademy"

echo "Both sites deployed. Next: connect custom domains in Netlify, add the"
echo "Shopify orders/paid webhook -> https://canesweatherschool.com/api/shopify-webhook"
