#!/bin/sh
set -e

DATA_DIR="/app/prisma/data"

# --- Fix ownership on bind-mounted volumes ---
chown -R nextjs:nodejs "$DATA_DIR"
chown -R nextjs:nodejs /config/frigate

# --- Auto-generate JWT_SECRET if not provided ---
if [ -z "$JWT_SECRET" ]; then
  SECRET_FILE="$DATA_DIR/.jwt-secret"
  if [ ! -f "$SECRET_FILE" ]; then
    su-exec nextjs node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" > "$SECRET_FILE"
    chown nextjs:nodejs "$SECRET_FILE"
    echo "[Init] Generated JWT_SECRET (stored in volume)"
  fi
  export JWT_SECRET=$(cat "$SECRET_FILE")
fi

# --- Auto-generate VAPID keys if not provided ---
if [ -z "$VAPID_PUBLIC_KEY" ] || [ -z "$VAPID_PRIVATE_KEY" ]; then
  VAPID_FILE="$DATA_DIR/.vapid-keys"
  if [ ! -f "$VAPID_FILE" ]; then
    su-exec nextjs node -e "
      var c = require('crypto').createECDH('prime256v1');
      c.generateKeys();
      process.stdout.write(c.getPublicKey('base64url','uncompressed') + '\n' + c.getPrivateKey('base64url'));
    " > "$VAPID_FILE"
    chown nextjs:nodejs "$VAPID_FILE"
    echo "[Init] Generated VAPID keys (stored in volume)"
  fi
  export VAPID_PUBLIC_KEY=$(sed -n '1p' "$VAPID_FILE")
  export VAPID_PRIVATE_KEY=$(sed -n '2p' "$VAPID_FILE")
fi

# --- Run Prisma migrations as nextjs user ---
su-exec nextjs node node_modules/prisma/build/index.js migrate deploy

# --- Start the application as nextjs user ---
exec su-exec nextjs node server.js
