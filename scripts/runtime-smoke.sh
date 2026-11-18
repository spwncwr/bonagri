#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# macOS idles into deep sleep once the display turns off, pausing the run
# mid-flight (2026-11-18: two runs slept 16-17 min at step 11b and HP5's
# 15-minute access token expired during the pause → false 401). Re-exec under
# caffeinate so the machine stays awake for the whole suite; no-op anywhere
# without the command (Linux CI, containers).
if [[ "${SMOKE_AWAKE:-}" != "1" ]] && command -v caffeinate >/dev/null 2>&1; then
  export SMOKE_AWAKE=1
  exec caffeinate -is bash "$SCRIPT_DIR/runtime-smoke.sh" "$@"
fi

ROOT="$REPO_ROOT"
API="$ROOT/api"
WEB="$ROOT/web"

API_URL="${API_URL:-http://localhost:3000}"
WEB_URL="${WEB_URL:-http://localhost:3001}"
API_PREFIX="${API_PREFIX:-/api}"

# This suite writes to whatever it points at: it registers accounts, re-roles the
# smoke buyer, places orders and publishes promotions. Refuse anything that is
# not a local development server so a stray API_URL cannot hit a deployment.
local_url() {
  local authority host
  authority="$(printf '%s' "$1" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##; s#^[^/@]*@##; s#[/?].*$##')"

  # Strip a trailing :port; a bare IPv6 authority such as ::1 keeps its colons.
  host="$(printf '%s' "$authority" | sed -E 's#:[0-9]+$##')"

  case "$host" in
    localhost | 127.0.0.1 | ::1 | 0.0.0.0 | \[::1\]) return 0 ;;
    *) return 1 ;;
  esac
}

if ! local_url "$API_URL" || ! local_url "$WEB_URL"; then
  echo "ERROR: runtime smoke only targets a local development server." >&2
  echo "       got API_URL=$API_URL WEB_URL=$WEB_URL" >&2
  exit 1
fi

TEST_EMAIL="e2e_buyer_$(date +%s)@bonagri.local"
TEST_PASSWORD='BonAgri-E2E-2026!'
LOG_DIR="$ROOT/.runtime-test"
mkdir -p "$LOG_DIR"

cleanup() {
  echo
  echo "========================================"
  echo "RUNTIME SMOKE TEST CLEANUP"
  echo "========================================"

  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT

fail() {
  echo
  echo "❌ RUNTIME TEST FAILED"
  echo "$1"
  echo
  exit 1
}

request() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local token="${4:-}"

  if [[ -n "$token" ]]; then
    if [[ -n "$body" ]]; then
      curl -sS -X "$method" "$url" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "$body"
    else
      curl -sS -X "$method" "$url" \
        -H "Authorization: Bearer $token"
    fi
  else
    if [[ -n "$body" ]]; then
      curl -sS -X "$method" "$url" \
        -H "Content-Type: application/json" \
        -d "$body"
    else
      curl -sS -X "$method" "$url"
    fi
  fi
}

# HP2: admin sign-in is two-step (mandatory TOTP). This helper enrols the
# admin on first contact and caches {secret, recoveryCodes} in .runtime-test
# (persists across runs) so later admin logins just mint a fresh code.
# Everything except the access token is written to $LOG_DIR files — the token
# is the ONLY thing on stdout, so `TOKEN="$(admin_login …)"` cannot be
# polluted by progress output. The TOTP below is an INDEPENDENT RFC 6238
# implementation: if it ever disagrees with the API's own totp.ts, verify
# fails loudly instead of silently passing.
# fail() writes to stdout — inside `TOKEN="$(admin_login …)"` that output
# would be swallowed by the substitution, so the helper's failures go to
# stderr and still abort via set -e (plus the callers' empty-token guard).
admin_fail() {
  echo >&2
  echo "❌ RUNTIME TEST FAILED" >&2
  echo "$1" >&2
  echo >&2
  exit 1
}

ADMIN_2FA_STATE="$LOG_DIR/admin-2fa-state.json"

admin_totp() {
  node -e '
    const crypto = require("crypto");
    const secret = String(process.argv[1]).toUpperCase().replace(/\s+/g, "");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0, value = 0;
    const bytes = [];
    for (const ch of secret) {
      const idx = alphabet.indexOf(ch);
      if (idx < 0) { console.error("bad base32 secret"); process.exit(2); }
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
    const hmac = crypto.createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
    const off = hmac[hmac.length - 1] & 0xf;
    const code = (((hmac[off] & 0x7f) << 24 | hmac[off + 1] << 16 | hmac[off + 2] << 8 | hmac[off + 3]) % 1e6);
    process.stdout.write(String(code).padStart(6, "0"));
  ' "$1"
}

admin_login() {
  local email="$1"
  local password="$2"
  local login_file="$LOG_DIR/admin-login.json"
  local http kind pre

  http="$(
    curl -sS -o "$login_file" -w "%{http_code}" \
      -X POST "$API_URL$API_PREFIX/auth/login" \
      -H "Content-Type: application/json" \
      -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$email" "$password")"
  )"
  if [ "$http" != "201" ]; then
    cat "$login_file" >&2
    admin_fail "Admin login failed (check SEED_ADMIN_* env and that the seed ran). HTTP $http"
  fi

  kind="$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1],encoding="utf-8"))
if d.get("twoFactorSetupRequired"): print("setup")
elif d.get("twoFactorRequired"): print("verify")
elif d.get("accessToken"): print("plain")
else: print("unknown")
' "$login_file")"
  pre="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("preAuthToken",""))' "$login_file")"

  if [ "$kind" = "plain" ]; then
    printf '%s' "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["accessToken"])' "$login_file")"
    return 0
  fi

  if [ "$kind" = "unknown" ] || [ -z "$pre" ]; then
    admin_fail "Admin login returned neither a session nor a pre-auth token"
  fi

  if [ "$kind" = "setup" ]; then
    # Unenrolled admin (fresh DB or first run after HP2): enrol for real.
    local setup_file="$LOG_DIR/admin-2fa-setup.json"
    local enable_file="$LOG_DIR/admin-2fa-enable.json"
    local secret code

    http="$(
      curl -sS -o "$setup_file" -w "%{http_code}" \
        -X POST "$API_URL$API_PREFIX/auth/2fa/setup" \
        -H "Authorization: Bearer $pre"
    )"
    if [ "$http" != "201" ]; then
      cat "$setup_file" >&2
      admin_fail "Admin 2FA setup failed. HTTP $http"
    fi
    secret="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["secret"])' "$setup_file")"

    code="$(admin_totp "$secret")"
    http="$(
      curl -sS -o "$enable_file" -w "%{http_code}" \
        -X POST "$API_URL$API_PREFIX/auth/2fa/enable" \
        -H "Authorization: Bearer $pre" \
        -H "Content-Type: application/json" \
        -d "$(python3 -c 'import json,sys; print(json.dumps({"code":sys.argv[1]}))' "$code")"
    )"
    if [ "$http" != "201" ]; then
      cat "$enable_file" >&2
      admin_fail "Admin 2FA enable failed (TOTP mismatch between smoke and API?). HTTP $http"
    fi

    python3 - "$enable_file" "$secret" "$ADMIN_2FA_STATE" <<'PYSTATE'
import json, sys
enable = json.load(open(sys.argv[1], encoding="utf-8"))
state = {"secret": sys.argv[2], "recoveryCodes": enable.get("recoveryCodes", [])}
with open(sys.argv[3], "w", encoding="utf-8") as f:
    json.dump(state, f, indent=2)
PYSTATE

    printf '%s' "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["accessToken"])' "$enable_file")"
    return 0
  fi

  # kind = verify: enrolled admin — fresh TOTP from the cached secret.
  if [ ! -f "$ADMIN_2FA_STATE" ]; then
    admin_fail "Admin is enrolled in 2FA but $ADMIN_2FA_STATE is missing — restore it or disable 2FA for the seed admin in the DB."
  fi

  local verify_file="$LOG_DIR/admin-2fa-verify.json"
  local vcode
  vcode="$(admin_totp "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["secret"])' "$ADMIN_2FA_STATE")")"
  http="$(
    curl -sS -o "$verify_file" -w "%{http_code}" \
      -X POST "$API_URL$API_PREFIX/auth/2fa/verify" \
      -H "Authorization: Bearer $pre" \
      -H "Content-Type: application/json" \
      -d "$(python3 -c 'import json,sys; print(json.dumps({"code":sys.argv[1]}))' "$vcode")"
  )"
  if [ "$http" != "201" ]; then
    cat "$verify_file" >&2
    admin_fail "Admin 2FA verify failed (clock drift or stale state file?). HTTP $http"
  fi

  printf '%s' "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["accessToken"])' "$verify_file")"
}

# HP3 (plan G3): password-confirmed step-up token for guarded admin mutations
# (POST /auth/step-up → X-Step-Up header). Cached in $LOG_DIR and refreshed
# only when older than 4 minutes (server TTL is 5), so a burst of mutations
# costs ONE password check (bucket: 10/min) while no call can ever present a
# stale token. Takes the admin access token as $1; prints ONLY the step-up
# token — same stdout discipline as admin_login.
admin_step_up() {
  local bearer="$1"
  local token_file="$LOG_DIR/admin-step-up.json"
  local http

  if [ -z "${ADMIN_E2E_PASSWORD:-}" ]; then
    admin_fail "step-up requested but ADMIN_E2E_PASSWORD is not set"
  fi

  if [ ! -f "$token_file" ] || [ -n "$(find "$token_file" -mmin +4 2>/dev/null)" ]; then
    http="$(
      curl -sS -o "$token_file.new" -w "%{http_code}" \
        -X POST "$API_URL$API_PREFIX/auth/step-up" \
        -H "Authorization: Bearer $bearer" \
        -H "Content-Type: application/json" \
        -d "$(python3 -c 'import json,sys; print(json.dumps({"password":sys.argv[1]}))' "$ADMIN_E2E_PASSWORD")"
    )"
    if [ "$http" != "201" ]; then
      cat "$token_file.new" >&2
      rm -f "$token_file.new"
      admin_fail "step-up token mint failed. HTTP $http"
    fi
    mv "$token_file.new" "$token_file"
  fi

  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["stepUpToken"], end="")' "$token_file"
}

echo "========================================"
echo "BONAGRI RUNTIME SMOKE TEST"
echo "========================================"
echo "API: $API_URL"
echo "WEB: $WEB_URL"
echo "TEST EMAIL: $TEST_EMAIL"
echo

echo "[1/12] Checking PostgreSQL / Prisma..."
cd "$API"
npx prisma db execute --stdin >/dev/null <<'SQL'
SELECT 1;
SQL
echo "✓ Database reachable"

# The suite must own the ports: a stray dev server would answer the
# readiness probe below with the wrong environment (no mail capture) while
# our own API dies silently with EADDRINUSE behind it.
for probe in "$API_URL" "$WEB_URL"; do
  if curl -sS -o /dev/null --max-time 2 "$probe" 2>/dev/null; then
    echo "ERROR: $probe is already serving; stop that server before running the smoke." >&2
    exit 1
  fi
done

echo
echo "[2/12] Starting API..."
cd "$API"

CAPTURE_FILE="$ROOT/.e2e/verification-url.txt"
DISPUTE_CAPTURE_FILE="$ROOT/.e2e/dispute-resolution.txt"
NOTIFY_CAPTURE_FILE="$ROOT/.e2e/notifications.txt"
OTP_CAPTURE_FILE="$ROOT/.e2e/phone-otp.txt"
# HP2: admin sign-in alert — its own file so section T's assertion cannot be
# clobbered by other notification mail.
ADMIN_LOGIN_CAPTURE_FILE="$ROOT/.e2e/admin-login-alert.txt"
# HP4: password-reset link — its own file so section W can tell a fresh link
# apart from the verification URL captured earlier.
RESET_CAPTURE_FILE="$ROOT/.e2e/reset-url.txt"
mkdir -p "$ROOT/.e2e"
rm -f "$CAPTURE_FILE"
rm -f "$DISPUTE_CAPTURE_FILE"
rm -f "$NOTIFY_CAPTURE_FILE"
rm -f "$OTP_CAPTURE_FILE"
rm -f "$ADMIN_LOGIN_CAPTURE_FILE"
rm -f "$RESET_CAPTURE_FILE"

E2E_CAPTURE_MAIL=true \
E2E_MAIL_CAPTURE_FILE="$CAPTURE_FILE" \
E2E_DISPUTE_CAPTURE_FILE="$DISPUTE_CAPTURE_FILE" \
E2E_NOTIFY_CAPTURE_FILE="$NOTIFY_CAPTURE_FILE" \
E2E_OTP_CAPTURE_FILE="$OTP_CAPTURE_FILE" \
E2E_ADMIN_LOGIN_CAPTURE_FILE="$ADMIN_LOGIN_CAPTURE_FILE" \
E2E_RESET_CAPTURE_FILE="$RESET_CAPTURE_FILE" \
npm run start:dev >"$LOG_DIR/api.log" 2>&1 &
API_PID=$!

for i in {1..60}; do
  if curl -sS "$API_URL$API_PREFIX/categories" >/dev/null 2>&1; then
    echo "✓ API responding"
    break
  fi

  if ! kill -0 "$API_PID" 2>/dev/null; then
    cat "$LOG_DIR/api.log"
    fail "API process exited."
  fi

  sleep 1

  if [[ "$i" == "60" ]]; then
    cat "$LOG_DIR/api.log"
    fail "API did not become ready."
  fi
done

echo
echo "[3/12] Starting frontend..."
cd "$WEB"
npm run dev -- --port 3001 >"$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!

for i in {1..60}; do
  if curl -sS "$WEB_URL/login" >/dev/null 2>&1; then
    echo "✓ Frontend responding"
    break
  fi

  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    cat "$LOG_DIR/web.log"
    fail "Frontend process exited."
  fi

  sleep 1

  if [[ "$i" == "60" ]]; then
    cat "$LOG_DIR/web.log"
    fail "Frontend did not become ready."
  fi
done

echo
echo "[4/12] Testing public catalog..."
CATALOG="$(request GET "$API_URL$API_PREFIX/categories")"

echo "$CATALOG" | grep -q '\[' \
  || fail "Categories endpoint did not return an array."

echo "✓ Categories endpoint responding"

echo
echo "[5/12] Testing registration..."
REGISTER_RESPONSE="$(
  request POST "$API_URL$API_PREFIX/auth/register" \
  "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"firstName\":\"E2E\",\"lastName\":\"Buyer\"}"
)"

if ! echo "$REGISTER_RESPONSE" | grep -q '"emailVerificationRequired"[[:space:]]*:[[:space:]]*true'; then
  echo "Registration response:"
  echo "$REGISTER_RESPONSE"
  fail "Registration did not require email verification."
fi

echo "✓ Buyer registration accepted"
echo "✓ Email verification required"

echo
echo "[6/12] Testing unverified-login protection..."
LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"
)"

if [[ "$LOGIN_HTTP" != "401" && "$LOGIN_HTTP" != "403" ]]; then
  cat "$LOG_DIR/login.json"
  fail "Unverified buyer was not blocked from login. HTTP $LOGIN_HTTP"
fi

echo "✓ Unverified buyer blocked from login"

echo
echo "[7/12] Capturing verification URL..."

CAPTURE_FILE="$ROOT/.e2e/verification-url.txt"


echo
echo "[7b/12] Waiting for verification URL..."

for _ in $(seq 1 30); do
  if [[ -s "$CAPTURE_FILE" ]]; then
    break
  fi
  sleep 0.5
done

if [[ ! -s "$CAPTURE_FILE" ]]; then
  fail "Verification URL was not captured."
fi

VERIFICATION_URL="$(cat "$CAPTURE_FILE")"

if [[ "$VERIFICATION_URL" != *"/verify-email?token="* ]]; then
  echo "Captured value:"
  cat "$CAPTURE_FILE"
  fail "Captured verification URL is invalid."
fi

VERIFICATION_TOKEN="${VERIFICATION_URL##*token=}"

if [[ -z "$VERIFICATION_TOKEN" ]]; then
  fail "Verification token could not be extracted."
fi

echo "✓ Raw verification token captured"

echo
echo "[7c/12] Verifying email..."

VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/verify.json" -w "%{http_code}" \
    --get \
    --data-urlencode "token=$VERIFICATION_TOKEN" \
    "$API_URL$API_PREFIX/auth/verify-email"
)"

if [[ "$VERIFY_HTTP" != "200" ]]; then
  cat "$LOG_DIR/verify.json"
  fail "Email verification failed. HTTP $VERIFY_HTTP"
fi

if ! grep -q '"emailVerified"[[:space:]]*:[[:space:]]*true' "$LOG_DIR/verify.json"; then
  cat "$LOG_DIR/verify.json"
  fail "Verification response did not confirm email verification."
fi

echo "✓ Email verification succeeded"

echo
echo "[7d/12] Confirming verified state in PostgreSQL..."

USER_STATE="$(
  psql "${E2E_PSQL_TARGET:-bonagri}" -v ON_ERROR_STOP=1 -v email="$TEST_EMAIL" -At <<'SQL' || true
SELECT json_build_object('id', "id", 'emailVerifiedAt', "emailVerifiedAt")
FROM "User"
WHERE "email" = :'email' AND "emailVerifiedAt" IS NOT NULL;
SQL
)"

if [[ -z "$USER_STATE" ]]; then
  fail "Database does not show the E2E user as verified."
fi

USER_ID="$(printf '%s' "$USER_STATE" | python3 -c '
import json,sys
data=json.load(sys.stdin)
print(data["id"])
')"

echo "✓ Database verification state confirmed"
echo "✓ Verified user: $USER_ID"

echo
echo "[7e/12] Verifying token cannot be reused..."

REUSE_HTTP="$(
  curl -sS -o "$LOG_DIR/verify-reuse.json" -w "%{http_code}" \
    --get \
    --data-urlencode "token=$VERIFICATION_TOKEN" \
    "$API_URL$API_PREFIX/auth/verify-email"
)"

if [[ "$REUSE_HTTP" != "401" ]]; then
  cat "$LOG_DIR/verify-reuse.json"
  fail "Unexpected verification-token reuse response: HTTP $REUSE_HTTP"
fi

echo "✓ Verification token reuse handled"

echo
echo "[8/12] Testing verified buyer login..."

VERIFIED_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/verified-login.json" -w "%{http_code}"     -X POST "$API_URL$API_PREFIX/auth/login"     -H "Content-Type: application/json"     -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"
)"

if [[ "$VERIFIED_LOGIN_HTTP" != "201" ]]; then
  cat "$LOG_DIR/verified-login.json"
  fail "Verified buyer login failed. HTTP $VERIFIED_LOGIN_HTTP"
fi

ACCESS_TOKEN="$(
  python3 -c '
import json,sys
with open(sys.argv[1]) as f:
    data=json.load(f)
print(data.get("accessToken",""))
' "$LOG_DIR/verified-login.json"
)"

if [[ -z "$ACCESS_TOKEN" ]]; then
  cat "$LOG_DIR/verified-login.json"
  fail "Login succeeded but no accessToken was returned."
fi

echo "✓ Verified buyer logged in and received an access token"

echo
echo "[8b/12] Testing authenticated /auth/me..."

ME_HTTP="$(
  curl -sS -o "$LOG_DIR/me.json" -w "%{http_code}"     -H "Authorization: Bearer $ACCESS_TOKEN"     "$API_URL$API_PREFIX/auth/me"
)"

if [[ "$ME_HTTP" != "200" ]]; then
  cat "$LOG_DIR/me.json"
  fail "Access token was rejected by /auth/me. HTTP $ME_HTTP"
fi

echo "✓ Access token accepted by /auth/me"

echo
echo
echo "[9/12] Testing authenticated catalog selection..."

PRODUCTS_HTTP="$(
  curl -sS -o "$LOG_DIR/products-auth.json" -w "%{http_code}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API_URL$API_PREFIX/products"
)"

if [[ "$PRODUCTS_HTTP" != "200" ]]; then
  cat "$LOG_DIR/products-auth.json"
  fail "Authenticated product catalog failed. HTTP $PRODUCTS_HTTP"
fi

PRODUCT_SELECTION="$(
  python3 - "$LOG_DIR/products-auth.json" <<'PYJSON'
import json
import sys

with open(sys.argv[1]) as f:
    data = json.load(f)

items = data
if isinstance(data, dict):
    for key in ("products", "items", "data"):
        if isinstance(data.get(key), list):
            items = data[key]
            break

if not isinstance(items, list) or not items:
    raise SystemExit("No products returned from catalog.")

active = [
    item for item in items
    if str(item.get("status", "ACTIVE")).upper() == "ACTIVE"
]

if not active:
    raise SystemExit("No ACTIVE products returned from catalog.")

# Pin to the seeded development supplier listing so the vendor-queue
# checks stay deterministic - the CP4 dealer tool listing also lives in
# this catalog and could otherwise sort first.
product = active[0]
for item in active:
    if item.get("slug") == "fresh-tomatoes":
        product = item
        break
product_id = product.get("id")
product_name = product.get("name")
available = product.get("available")

if not product_id or not product_name:
    raise SystemExit("Catalog product is missing id or name.")

print(json.dumps({
    "id": product_id,
    "name": product_name,
    "available": available,
}))
PYJSON
)"

PRODUCT_ID="$(
  printf '%s' "$PRODUCT_SELECTION" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])'
)"

PRODUCT_NAME="$(
  printf '%s' "$PRODUCT_SELECTION" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])'
)"

echo "✓ Active product selected: $PRODUCT_NAME"
echo "✓ Product ID: $PRODUCT_ID"

echo
echo "[10/12] Creating buyer delivery address..."

ADDRESS_HTTP="$(
  curl -sS -o "$LOG_DIR/address-create.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/addresses" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "label":"E2E Delivery Address",
      "recipientName":"BonAgri E2E Buyer",
      "phone":"+27820000001",
      "addressLine1":"1 E2E Test Street",
      "city":"Giyani",
      "province":"Limpopo",
      "postalCode":"0826",
      "country":"South Africa",
      "isDefault":true
    }'
)"

if [[ "$ADDRESS_HTTP" != "201" ]]; then
  cat "$LOG_DIR/address-create.json"
  fail "Buyer address creation failed. HTTP $ADDRESS_HTTP"
fi

ADDRESS_ID="$(
  python3 - "$LOG_DIR/address-create.json" <<'PYJSON'
import json
import sys

with open(sys.argv[1]) as f:
    data = json.load(f)

address_id = data.get("id")

if not address_id and isinstance(data.get("address"), dict):
    address_id = data["address"].get("id")

if not address_id:
    raise SystemExit("Address creation succeeded but no address id was returned.")

print(address_id)
PYJSON
)"

echo "✓ Buyer delivery address created"
echo "✓ Address ID: $ADDRESS_ID"

echo
echo "[10b/12] Confirming buyer address retrieval..."

ADDRESSES_HTTP="$(
  curl -sS -o "$LOG_DIR/addresses.json" -w "%{http_code}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API_URL$API_PREFIX/addresses"
)"

if [[ "$ADDRESSES_HTTP" != "200" ]]; then
  cat "$LOG_DIR/addresses.json"
  fail "Buyer address retrieval failed. HTTP $ADDRESSES_HTTP"
fi

python3 - "$LOG_DIR/addresses.json" "$ADDRESS_ID" <<'PYJSON'
import json
import sys

with open(sys.argv[1]) as f:
    data = json.load(f)

expected_id = sys.argv[2]

items = data
if isinstance(data, dict):
    for key in ("addresses", "items", "data"):
        if isinstance(data.get(key), list):
            items = data[key]
            break

if not isinstance(items, list):
    raise SystemExit("Address endpoint did not return an address list.")

if not any(item.get("id") == expected_id for item in items):
    raise SystemExit("Created delivery address was not returned for the buyer.")
PYJSON

echo "✓ Created address returned for authenticated buyer"

echo
echo "[11/12] Creating authenticated buyer order..."

BEFORE_RESERVED="$(
  psql "${E2E_PSQL_TARGET:-bonagri}" -v ON_ERROR_STOP=1 -At \
    -v product_id="$PRODUCT_ID" <<'SQL'
SELECT COALESCE(i."reservedQuantity", 0)
FROM "Product" p
LEFT JOIN "Inventory" i ON i."productId" = p.id
WHERE p.id = :'product_id';
SQL
)"

BEFORE_RESERVED="${BEFORE_RESERVED//$'\n'/}"

if [[ -z "$BEFORE_RESERVED" ]]; then
  fail "Could not read inventory reservation before order creation."
fi

ORDER_HTTP="$(
  curl -sS -o "$LOG_DIR/order-create.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"deliveryAddressId\":\"$ADDRESS_ID\",
      \"productId\":\"$PRODUCT_ID\",
      \"quantity\":1,
      \"notes\":\"Automated BonAgri E2E order\"
    }"
)"

if [[ "$ORDER_HTTP" != "201" ]]; then
  cat "$LOG_DIR/order-create.json"
  fail "Buyer order creation failed. HTTP $ORDER_HTTP"
fi

ORDER_DATA="$(
  python3 - "$LOG_DIR/order-create.json" <<'PYJSON'
import json
import sys

with open(sys.argv[1]) as f:
    data = json.load(f)

order = data.get("order") if isinstance(data.get("order"), dict) else data

order_id = order.get("id")
order_number = order.get("orderNumber")
status = order.get("status")

if not order_id or not order_number:
    raise SystemExit("Order creation succeeded but order identity was not returned.")

print(json.dumps({
    "id": order_id,
    "orderNumber": order_number,
    "status": status,
}))
PYJSON
)"

ORDER_ID="$(
  printf '%s' "$ORDER_DATA" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])'
)"

ORDER_NUMBER="$(
  printf '%s' "$ORDER_DATA" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["orderNumber"])'
)"

ORDER_STATUS="$(
  printf '%s' "$ORDER_DATA" |
    python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))'
)"

echo "✓ Buyer order created"
echo "✓ Order ID: $ORDER_ID"
echo "✓ Order number: $ORDER_NUMBER"
echo "✓ Order status: $ORDER_STATUS"

echo
echo "[11b/12] Confirming order through buyer orders endpoint..."

ORDERS_HTTP="$(
  curl -sS -o "$LOG_DIR/orders.json" -w "%{http_code}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API_URL$API_PREFIX/orders"
)"

if [[ "$ORDERS_HTTP" != "200" ]]; then
  cat "$LOG_DIR/orders.json"
  fail "Buyer orders endpoint failed. HTTP $ORDERS_HTTP"
fi

python3 - "$LOG_DIR/orders.json" "$ORDER_ID" <<'PYJSON'
import json
import sys

with open(sys.argv[1]) as f:
    data = json.load(f)

expected_id = sys.argv[2]

items = data
if isinstance(data, dict):
    for key in ("orders", "items", "data"):
        if isinstance(data.get(key), list):
            items = data[key]
            break

if not isinstance(items, list):
    raise SystemExit("Buyer orders endpoint did not return an order list.")

if not any(item.get("id") == expected_id for item in items):
    raise SystemExit("Created order was not returned by buyer orders endpoint.")
PYJSON

echo "✓ Created order returned for authenticated buyer"

echo
echo "[11c/12] Confirming inventory reservation..."

AFTER_RESERVED="$(
  psql "${E2E_PSQL_TARGET:-bonagri}" -v ON_ERROR_STOP=1 -At \
    -v product_id="$PRODUCT_ID" <<'SQL'
SELECT COALESCE(i."reservedQuantity", 0)
FROM "Product" p
LEFT JOIN "Inventory" i ON i."productId" = p.id
WHERE p.id = :'product_id';
SQL
)"

AFTER_RESERVED="${AFTER_RESERVED//$'\n'/}"

EXPECTED_RESERVED="$((BEFORE_RESERVED + 1))"

if [[ "$AFTER_RESERVED" != "$EXPECTED_RESERVED" ]]; then
  echo "Before reserved quantity: $BEFORE_RESERVED"
  echo "Expected reserved quantity: $EXPECTED_RESERVED"
  echo "Actual reserved quantity: $AFTER_RESERVED"
  fail "Inventory reservation was not persisted correctly."
fi

echo "✓ Inventory reservation increased by 1"

echo
echo "========================================"
echo "SUPPLIER ORDER VISIBILITY / STATUS ACCEPTANCE"
echo "========================================"
echo

echo "[S1/10] Loading deterministic development supplier credentials..."

# Development E2E supplier seeded by api/prisma/seed.ts.
# Override with SUPPLIER_E2E_EMAIL / SUPPLIER_E2E_PASSWORD when required.
SUPPLIER_EMAIL="${SUPPLIER_E2E_EMAIL:-dev@bonagri.co.za}"
SUPPLIER_PASSWORD="${SUPPLIER_E2E_PASSWORD:-bonagri2024dev}"

if [ -z "$SUPPLIER_EMAIL" ] || [ -z "$SUPPLIER_PASSWORD" ]; then
  echo "ERROR: supplier E2E credentials are empty"
  exit 1
fi

echo "✓ Development supplier configured: $SUPPLIER_EMAIL"

echo
echo "[S2/10] Authenticating supplier..."

SUPPLIER_LOGIN_PAYLOAD="$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$SUPPLIER_EMAIL" "$SUPPLIER_PASSWORD")"

SUPPLIER_LOGIN_HTTP="$(curl -sS -o "$LOG_DIR/supplier-login.json" \
  -w '%{http_code}' \
  -X POST "$API_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  --data "$SUPPLIER_LOGIN_PAYLOAD")"

if [ "$SUPPLIER_LOGIN_HTTP" != "201" ] && [ "$SUPPLIER_LOGIN_HTTP" != "200" ]; then
  echo "ERROR: supplier login failed with HTTP $SUPPLIER_LOGIN_HTTP"
  cat "$LOG_DIR/supplier-login.json"
  exit 1
fi

SUPPLIER_TOKEN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("accessToken",""))' "$LOG_DIR/supplier-login.json")"

if [ -z "$SUPPLIER_TOKEN" ]; then
  echo "ERROR: supplier access token missing"
  cat "$LOG_DIR/supplier-login.json"
  exit 1
fi

echo "✓ Supplier authenticated"

echo
echo "[S3/10] Confirming supplier order visibility..."

SUPPLIER_ORDERS_HTTP="$(curl -sS -o "$LOG_DIR/supplier-orders.json" \
  -w '%{http_code}' \
  -H "Authorization: Bearer $SUPPLIER_TOKEN" \
  "$API_URL/api/orders/supplier")"

if [ "$SUPPLIER_ORDERS_HTTP" != "200" ]; then
  echo "ERROR: supplier order endpoint returned HTTP $SUPPLIER_ORDERS_HTTP"
  cat "$LOG_DIR/supplier-orders.json"
  exit 1
fi

python3 -c '
import json
import sys

path = sys.argv[1]
order_id = sys.argv[2]

with open(path, encoding="utf-8") as f:
    data = json.load(f)

if not isinstance(data, list):
    raise SystemExit("ERROR: supplier orders response is not an array")

matches = [o for o in data if o.get("id") == order_id]

if not matches:
    raise SystemExit("ERROR: supplier cannot see buyer-created order {}".format(order_id))

order = matches[0]

print("✓ Supplier can see order {}".format(order.get("orderNumber")))
print("✓ Supplier-visible status: {}".format(order.get("status")))

if order.get("status") != "PENDING":
    raise SystemExit(
        "ERROR: expected supplier-visible status PENDING, got {}".format(
            order.get("status")
        )
    )
' "$LOG_DIR/supplier-orders.json" "$ORDER_ID"

echo
echo "[S4/10] Confirming buyer cannot access supplier order endpoint..."

BUYER_SUPPLIER_HTTP="$(curl -sS -o "$LOG_DIR/buyer-supplier-orders.json" \
  -w '%{http_code}' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$API_URL/api/orders/supplier")"

if [ "$BUYER_SUPPLIER_HTTP" != "403" ]; then
  echo "ERROR: buyer unexpectedly received HTTP $BUYER_SUPPLIER_HTTP"
  cat "$LOG_DIR/buyer-supplier-orders.json"
  exit 1
fi

echo "✓ Buyer correctly received HTTP 403"

echo
echo "[S5/10] Supplier accepting PENDING order..."

SUPPLIER_CONFIRM_HTTP="$(curl -sS -o "$LOG_DIR/supplier-confirm.json" \
  -w '%{http_code}' \
  -X PATCH "$API_URL/api/orders/$ORDER_ID/status" \
  -H "Authorization: Bearer $SUPPLIER_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"status":"CONFIRMED"}')"

if [ "$SUPPLIER_CONFIRM_HTTP" != "200" ]; then
  echo "ERROR: supplier confirmation returned HTTP $SUPPLIER_CONFIRM_HTTP"
  cat "$LOG_DIR/supplier-confirm.json"
  exit 1
fi

python3 -c '
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)

if data.get("status") != "CONFIRMED":
    raise SystemExit(
        "ERROR: expected CONFIRMED, got {}".format(data.get("status"))
    )

print("✓ Supplier transitioned PENDING → CONFIRMED")
' "$LOG_DIR/supplier-confirm.json"

echo
echo "[S6/10] Supplier processing order through lifecycle..."

for expected in PROCESSING READY_FOR_DELIVERY OUT_FOR_DELIVERY DELIVERED; do
  RESPONSE_FILE="$LOG_DIR/supplier-$(printf "%s" "$expected" | tr "[:upper:]" "[:lower:]").json"

  HTTP_CODE="$(curl -sS -o "$RESPONSE_FILE" \
    -w '%{http_code}' \
    -X PATCH "$API_URL/api/orders/$ORDER_ID/status" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H 'Content-Type: application/json' \
    --data "{\"status\":\"$expected\"}")"

  if [ "$HTTP_CODE" != "200" ]; then
    echo "ERROR: supplier transition to $expected returned HTTP $HTTP_CODE"
    cat "$RESPONSE_FILE"
    exit 1
  fi

  python3 -c '
import json
import sys

path = sys.argv[1]
expected = sys.argv[2]

with open(path, encoding="utf-8") as f:
    data = json.load(f)

actual = data.get("status")

if actual != expected:
    raise SystemExit(
        "ERROR: expected supplier transition {}, got {}".format(expected, actual)
    )

print("✓ Supplier transitioned order → {}".format(expected))
' "$RESPONSE_FILE" "$expected"
done

echo
echo "[S7/10] Confirming buyer sees final order status..."

BUYER_FINAL_HTTP="$(curl -sS -o "$LOG_DIR/buyer-final-orders.json" \
  -w '%{http_code}' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$API_URL/api/orders")"

if [ "$BUYER_FINAL_HTTP" != "200" ]; then
  echo "ERROR: buyer orders endpoint returned HTTP $BUYER_FINAL_HTTP"
  cat "$LOG_DIR/buyer-final-orders.json"
  exit 1
fi

python3 -c '
import json
import sys

path = sys.argv[1]
order_id = sys.argv[2]

with open(path, encoding="utf-8") as f:
    data = json.load(f)

if not isinstance(data, list):
    raise SystemExit("ERROR: buyer orders response is not an array")

matches = [o for o in data if o.get("id") == order_id]

if not matches:
    raise SystemExit(
        "ERROR: buyer cannot find final order {}".format(order_id)
    )

order = matches[0]

if order.get("status") != "DELIVERED":
    raise SystemExit(
        "ERROR: buyer sees final status {}, expected DELIVERED".format(
            order.get("status")
        )
    )

print("✓ Buyer sees final order status: {}".format(order.get("status")))
print("✓ Final order: {}".format(order.get("orderNumber")))
' "$LOG_DIR/buyer-final-orders.json" "$ORDER_ID"

echo
echo "[S8/10] Fetching order detail with status history..."

DETAIL_HTTP="$(curl -sS -o "$LOG_DIR/order-detail.json" \
  -w '%{http_code}' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$API_URL/api/orders/$ORDER_ID")"

if [ "$DETAIL_HTTP" != "200" ]; then
  echo "ERROR: buyer order detail endpoint returned HTTP $DETAIL_HTTP"
  cat "$LOG_DIR/order-detail.json"
  exit 1
fi

python3 - "$LOG_DIR/order-detail.json" <<'PYJSON'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    order = json.load(f)

history = order.get("history")

if not isinstance(history, list) or len(history) < 6:
    raise SystemExit(
        "ERROR: order history missing or too short: {}".format(history)
    )

first, last = history[0], history[-1]

if first.get("toStatus") != "PENDING" or first.get("fromStatus") is not None:
    raise SystemExit("ERROR: history does not start at PENDING")

if last.get("toStatus") != "DELIVERED":
    raise SystemExit("ERROR: history does not end at DELIVERED")

print(
    "✓ Order detail includes full status history ({} steps)".format(
        len(history)
    )
)
PYJSON

echo
echo "[S9/10] Supplier creating a public product listing..."

SMOKE_TS="$(date +%s)"
SMOKE_SLUG="smoke-test-listing-$SMOKE_TS"
SMOKE_SKU="BON-SMK-$SMOKE_TS"

SMOKE_CATEGORY_ID="$(curl -sS "$API_URL/api/categories" | python3 -c '
import json, sys

data = json.load(sys.stdin)
match = next((c for c in data if c.get("slug") == "vegetables"), None)

if not match:
    raise SystemExit("ERROR: vegetables category not found")

print(match["id"])
')"

CREATE_HTTP="$(curl -sS -o "$LOG_DIR/smoke-product-create.json" \
  -w '%{http_code}' \
  -X POST "$API_URL/api/products" \
  -H "Authorization: Bearer $SUPPLIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"categoryId\":\"$SMOKE_CATEGORY_ID\",\"name\":\"Smoke Test Listing\",\"slug\":\"$SMOKE_SLUG\",\"sku\":\"$SMOKE_SKU\",\"price\":10,\"unit\":\"kg\",\"quantity\":5,\"status\":\"ACTIVE\"}")"

if [ "$CREATE_HTTP" != "200" ] && [ "$CREATE_HTTP" != "201" ]; then
  echo "ERROR: supplier product creation failed with HTTP $CREATE_HTTP"
  cat "$LOG_DIR/smoke-product-create.json"
  exit 1
fi

SMOKE_PRODUCT_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/smoke-product-create.json")"

curl -sS "$API_URL/api/products" -o "$LOG_DIR/smoke-public-list.json"

python3 -c '
import json, sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
slugs = {p.get("slug") for p in data}

if sys.argv[2] not in slugs:
    raise SystemExit("ERROR: newly created listing is not publicly listed")
' "$LOG_DIR/smoke-public-list.json" "$SMOKE_SLUG"

GUARD_HTTP="$(curl -sS -o /dev/null -w '%{http_code}' "$API_URL/api/supplier/products")"

if [ "$GUARD_HTTP" != "401" ]; then
  echo "ERROR: anonymous supplier products access returned HTTP $GUARD_HTTP, expected 401"
  exit 1
fi

echo "✓ Supplier created listing; publicly listed; vendor route guarded"

echo
echo "[S10/10] Deactivating hides the listing from the public marketplace..."

DEACTIVATE_HTTP="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X PATCH "$API_URL/api/products/$SMOKE_PRODUCT_ID" \
  -H "Authorization: Bearer $SUPPLIER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"INACTIVE"}')"

if [ "$DEACTIVATE_HTTP" != "200" ]; then
  echo "ERROR: product deactivation failed with HTTP $DEACTIVATE_HTTP"
  exit 1
fi

curl -sS "$API_URL/api/products" -o "$LOG_DIR/smoke-public-list-after.json"

python3 -c '
import json, sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
slugs = {p.get("slug") for p in data}

if sys.argv[2] in slugs:
    raise SystemExit("ERROR: deactivated listing is still publicly listed")
' "$LOG_DIR/smoke-public-list-after.json" "$SMOKE_SLUG"

HIDDEN_DETAIL_HTTP="$(curl -sS -o /dev/null -w '%{http_code}' "$API_URL/api/products/$SMOKE_PRODUCT_ID")"

if [ "$HIDDEN_DETAIL_HTTP" != "404" ]; then
  echo "ERROR: deactivated product detail returned HTTP $HIDDEN_DETAIL_HTTP, expected 404"
  exit 1
fi

echo "✓ Deactivated listing hidden from list and detail (404)"

echo
echo "✓ SUPPLIER ORDER VISIBILITY / STATUS ACCEPTANCE PASSED"

echo
echo "========================================"
echo "CONSUMER FLOW: ADDRESSES / CANCEL / TIMELINE"
echo "========================================"

echo
echo "[C1/3] Managing buyer addresses..."

ADDR2_HTTP="$(curl -sS -o "$LOG_DIR/smoke-address-create.json" \
  -w '%{http_code}' \
  -X POST "$API_URL/api/addresses" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Smoke Backup","recipientName":"Smoke Buyer","addressLine1":"9 Test Street","city":"Polokwane","province":"Limpopo","postalCode":"0700"}')"

if [ "$ADDR2_HTTP" != "201" ] && [ "$ADDR2_HTTP" != "200" ]; then
  echo "ERROR: second address creation failed with HTTP $ADDR2_HTTP"
  cat "$LOG_DIR/smoke-address-create.json"
  exit 1
fi

ADDR2_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/smoke-address-create.json")"

echo "✓ Second address created: ${ADDR2_ID:0:8}..."

PATCH_DEFAULT_HTTP="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X PATCH "$API_URL/api/addresses/$ADDR2_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isDefault":true}')"

if [ "$PATCH_DEFAULT_HTTP" != "200" ]; then
  echo "ERROR: setting default failed with HTTP $PATCH_DEFAULT_HTTP"
  exit 1
fi

curl -sS "$API_URL/api/addresses" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -o "$LOG_DIR/smoke-addresses-default.json"

python3 - "$LOG_DIR/smoke-addresses-default.json" "$ADDR2_ID" <<'PYJSON'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
defaults = [a for a in data if a.get("isDefault")]

if len(defaults) != 1:
    raise SystemExit(
        "ERROR: expected exactly one default address, got {}".format(
            len(defaults)
        )
    )

if defaults[0]["id"] != sys.argv[2]:
    raise SystemExit("ERROR: default did not move to the updated address")

print("✓ Default moved to the updated address (exactly one default)")
PYJSON

# An address referenced by an existing order must refuse deletion.
ADDR_USED_HTTP="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X DELETE "$API_URL/api/addresses/$ADDRESS_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")"

if [ "$ADDR_USED_HTTP" != "400" ]; then
  echo "ERROR: deleting an order-used address returned HTTP $ADDR_USED_HTTP, expected 400"
  exit 1
fi

echo "✓ Order-used address protected from deletion (400)"

# Deleting the default promotes the remaining address back.
ADDR2_DELETE_HTTP="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X DELETE "$API_URL/api/addresses/$ADDR2_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")"

if [ "$ADDR2_DELETE_HTTP" != "200" ]; then
  echo "ERROR: second address deletion failed with HTTP $ADDR2_DELETE_HTTP"
  exit 1
fi

curl -sS "$API_URL/api/addresses" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -o "$LOG_DIR/smoke-addresses-after.json"

python3 - "$LOG_DIR/smoke-addresses-after.json" "$ADDR2_ID" "$ADDRESS_ID" <<'PYJSON'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
ids = {a["id"] for a in data}

if sys.argv[2] in ids:
    raise SystemExit("ERROR: deleted address still present")

defaults = [a for a in data if a.get("isDefault")]

if len(defaults) != 1 or defaults[0]["id"] != sys.argv[3]:
    raise SystemExit(
        "ERROR: original address was not promoted back to default"
    )

print("✓ Address deleted; original address promoted back to default")
PYJSON

echo
echo "[C2/3] Buyer cancelling a PENDING order releases stock..."

curl -sS "$API_URL/api/products/$PRODUCT_ID" \
  -o "$LOG_DIR/smoke-product-before.json"

BEFORE2_RESERVED="$(python3 -c '
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
print(data["inventory"]["reservedQuantity"])
' "$LOG_DIR/smoke-product-before.json")"

ORDER2_HTTP="$(curl -sS -o "$LOG_DIR/smoke-order-create.json" \
  -w '%{http_code}' \
  -X POST "$API_URL/api/orders" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"productId\":\"$PRODUCT_ID\",\"quantity\":1,\"notes\":\"CP2 cancel check\"}")"

if [ "$ORDER2_HTTP" != "201" ] && [ "$ORDER2_HTTP" != "200" ]; then
  echo "ERROR: throwaway order creation failed with HTTP $ORDER2_HTTP"
  cat "$LOG_DIR/smoke-order-create.json"
  exit 1
fi

ORDER2_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/smoke-order-create.json")"

curl -sS "$API_URL/api/products/$PRODUCT_ID" \
  -o "$LOG_DIR/smoke-product-reserved.json"

AFTER_CREATE_RESERVED="$(python3 -c '
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
print(data["inventory"]["reservedQuantity"])
' "$LOG_DIR/smoke-product-reserved.json")"

if [ "$AFTER_CREATE_RESERVED" != "$((BEFORE2_RESERVED + 1))" ]; then
  echo "ERROR: reservation did not increase by 1 (before=$BEFORE2_RESERVED after=$AFTER_CREATE_RESERVED)"
  exit 1
fi

echo "✓ Reservation increased by 1 after order creation"

CANCEL_HTTP="$(curl -sS -o "$LOG_DIR/smoke-order-cancel.json" \
  -w '%{http_code}' \
  -X PATCH "$API_URL/api/orders/$ORDER2_ID/status" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"CANCELLED"}')"

if [ "$CANCEL_HTTP" != "200" ]; then
  echo "ERROR: buyer cancel failed with HTTP $CANCEL_HTTP"
  cat "$LOG_DIR/smoke-order-cancel.json"
  exit 1
fi

curl -sS "$API_URL/api/products/$PRODUCT_ID" \
  -o "$LOG_DIR/smoke-product-released.json"

AFTER_CANCEL_RESERVED="$(python3 -c '
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
print(data["inventory"]["reservedQuantity"])
' "$LOG_DIR/smoke-product-released.json")"

if [ "$AFTER_CANCEL_RESERVED" != "$BEFORE2_RESERVED" ]; then
  echo "ERROR: reservation not released on cancel (before=$BEFORE2_RESERVED after=$AFTER_CANCEL_RESERVED)"
  exit 1
fi

echo "✓ Reservation released on buyer cancel (back to $AFTER_CANCEL_RESERVED)"

LATE_CANCEL_HTTP="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X PATCH "$API_URL/api/orders/$ORDER_ID/status" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"CANCELLED"}')"

if [ "$LATE_CANCEL_HTTP" != "400" ]; then
  echo "ERROR: cancelling a DELIVERED order returned HTTP $LATE_CANCEL_HTTP, expected 400"
  exit 1
fi

echo "✓ Cancel blocked past PENDING (400)"

echo
echo "[C3/3] Reading the cancelled order's status timeline..."

curl -sS "$API_URL/api/orders/$ORDER2_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -o "$LOG_DIR/smoke-order-timeline.json"

python3 - "$LOG_DIR/smoke-order-timeline.json" <<'PYJSON'
import json
import sys

order = json.load(open(sys.argv[1], encoding="utf-8"))

if order.get("status") != "CANCELLED":
    raise SystemExit(
        "ERROR: expected CANCELLED status, got {}".format(
            order.get("status")
        )
    )

history = order.get("history")

if not isinstance(history, list) or len(history) != 2:
    raise SystemExit(
        "ERROR: expected 2 history entries, got {}".format(history)
    )

first, last = history[0], history[-1]

if first.get("toStatus") != "PENDING" or first.get("fromStatus") is not None:
    raise SystemExit("ERROR: timeline does not start at PENDING")

if last.get("toStatus") != "CANCELLED" or last.get("actorRole") != "BUYER":
    raise SystemExit(
        "ERROR: timeline does not end with a buyer cancellation"
    )

print("✓ Cancelled order timeline: PENDING -> CANCELLED by BUYER")
PYJSON

echo
echo "✓ CONSUMER FLOW ACCEPTANCE PASSED"

echo
echo "DEALER FLOW: LISTING → ORDER → FULFILMENT"
echo "========================================"

echo
echo "[D1/3] Agro dealer login + tool listing under Tools..."

DEALER_EMAIL="${DEALER_E2E_EMAIL:-dealer@bonagri.co.za}"
DEALER_PASSWORD="${DEALER_E2E_PASSWORD:-bonagri2024dev}"

if [ -z "$DEALER_EMAIL" ] || [ -z "$DEALER_PASSWORD" ]; then
  fail "Agro dealer E2E credentials are empty"
fi

DEALER_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/dealer-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$DEALER_EMAIL" "$DEALER_PASSWORD")"
)"

if [[ "$DEALER_LOGIN_HTTP" != "201" ]]; then
  cat "$LOG_DIR/dealer-login.json"
  fail "Agro dealer login failed (seed must create dealer@bonagri.co.za). HTTP $DEALER_LOGIN_HTTP"
fi

DEALER_TOKEN="$(
  python3 -c '
import json,sys
with open(sys.argv[1]) as f:
    data=json.load(f)
assert data.get("user", {}).get("role") == "AGRO_DEALER", data.get("user", {}).get("role")
print(data.get("accessToken",""))
' "$LOG_DIR/dealer-login.json"
)"

echo "✓ Agro dealer logged in (role AGRO_DEALER)"

DEALER_OWN_HTTP="$(
  curl -sS -o "$LOG_DIR/dealer-own-products.json" -w "%{http_code}" \
    -X GET "$API_URL$API_PREFIX/supplier/products" \
    -H "Authorization: Bearer $DEALER_TOKEN"
)"

if [[ "$DEALER_OWN_HTTP" != "200" ]]; then
  fail "Dealer cannot list own products. HTTP $DEALER_OWN_HTTP"
fi

python3 - "$LOG_DIR/dealer-own-products.json" <<'PYJSON'
import json, sys

products = json.load(open(sys.argv[1], encoding="utf-8"))

if not any(p.get("slug") == "electric-fence-energizer-12j" for p in products):
    raise SystemExit("ERROR: seeded dealer listing missing from dealer's own list")

print("✓ Dealer sees own listings (incl. seeded energizer)")
PYJSON

DEALER_TS="$(date +%s)"
DEALER_SLUG="smoke-dealer-tool-$DEALER_TS"
DEALER_SKU="BON-DLR-$DEALER_TS"

DEALER_TOOLS_CATEGORY_ID="$(curl -sS "$API_URL$API_PREFIX/categories" | python3 -c '
import json, sys

data = json.load(sys.stdin)
match = next((c for c in data if c.get("slug") == "agricultural-tools"), None)

if not match:
    raise SystemExit("ERROR: agricultural-tools category not found")

print(match["id"])
')"

DEALER_CREATE_HTTP="$(
  curl -sS -o "$LOG_DIR/dealer-product-create.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/products" \
    -H "Authorization: Bearer $DEALER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"categoryId\":\"$DEALER_TOOLS_CATEGORY_ID\",\"name\":\"Smoke Dealer Tool\",\"slug\":\"$DEALER_SLUG\",\"sku\":\"$DEALER_SKU\",\"price\":99,\"unit\":\"each\",\"quantity\":3,\"status\":\"ACTIVE\"}")"

if [[ "$DEALER_CREATE_HTTP" != "200" ]] && [[ "$DEALER_CREATE_HTTP" != "201" ]]; then
  cat "$LOG_DIR/dealer-product-create.json"
  fail "Dealer product creation failed. HTTP $DEALER_CREATE_HTTP"
fi

# A well-formed but unknown categoryId must be refused up front (400), not
# surface as a foreign-key 500 — listings may only land in real categories.
BOGUS_CATEGORY_HTTP="$(
  curl -sS -o "$LOG_DIR/dealer-bogus-category.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/products" \
    -H "Authorization: Bearer $DEALER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"categoryId\":\"11111111-2222-4333-8444-555555555555\",\"name\":\"Ghost Category Tool\",\"slug\":\"ghost-category-tool-$DEALER_TS\",\"sku\":\"BON-GHOST-$DEALER_TS\",\"price\":10,\"unit\":\"each\"}")"

if [[ "$BOGUS_CATEGORY_HTTP" != "400" ]]; then
  cat "$LOG_DIR/dealer-bogus-category.json"
  fail "Unknown category should be 400, got HTTP $BOGUS_CATEGORY_HTTP"
fi

echo "✓ Unknown categoryId rejected with 400"

DEALER_PRODUCT_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/dealer-product-create.json"
)"

curl -sS "$API_URL$API_PREFIX/products" -o "$LOG_DIR/dealer-public-list.json"

python3 - "$LOG_DIR/dealer-public-list.json" "$DEALER_SLUG" <<'PYJSON'
import json, sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
slug = sys.argv[2]
match = next((p for p in data if p.get("slug") == slug), None)

if match is None:
    raise SystemExit("ERROR: dealer listing is not publicly listed")

business = match.get("supplier", {}).get("businessName")

if business != "Limpopo Agro Equipment":
    raise SystemExit("ERROR: dealer listing not owned by the dealer profile, got {}".format(business))

print("✓ Dealer listing publicly listed under Limpopo Agro Equipment")
PYJSON

echo
echo "[D2/3] Vendor guards: buyers blocked, dealers scoped to own products..."

BUYER_CREATE_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/products" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{}")"

if [[ "$BUYER_CREATE_HTTP" != "403" ]]; then
  fail "Buyer could create a product. HTTP $BUYER_CREATE_HTTP (expected 403)"
fi

BUYER_VENDOR_LIST_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X GET "$API_URL$API_PREFIX/supplier/products" \
    -H "Authorization: Bearer $ACCESS_TOKEN")"

if [[ "$BUYER_VENDOR_LIST_HTTP" != "403" ]]; then
  fail "Buyer could list vendor products. HTTP $BUYER_VENDOR_LIST_HTTP (expected 403)"
fi

DEALER_BUYER_ROUTE_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X GET "$API_URL$API_PREFIX/orders" \
    -H "Authorization: Bearer $DEALER_TOKEN")"

if [[ "$DEALER_BUYER_ROUTE_HTTP" != "403" ]]; then
  fail "Dealer could access the buyer order route. HTTP $DEALER_BUYER_ROUTE_HTTP (expected 403)"
fi

OTHER_PRODUCT_ID="$(python3 -c '
import json,sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
match = next((p for p in data if p.get("slug") == "fresh-tomatoes"), None)
if not match:
    raise SystemExit("ERROR: fresh-tomatoes listing not found")
print(match["id"])
' "$LOG_DIR/dealer-public-list.json")"

DEALER_CROSS_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/products/$OTHER_PRODUCT_ID" \
    -H "Authorization: Bearer $DEALER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"price":1}')"

if [[ "$DEALER_CROSS_HTTP" != "404" ]]; then
  fail "Dealer touched another vendor's product. HTTP $DEALER_CROSS_HTTP (expected 404)"
fi

echo "✓ Buyers 403 on vendor routes; dealer cross-vendor edit 404"

echo
echo "[D3/3] Buyer orders the dealer's tool; dealer fulfils to DELIVERED..."

DEALER_ORDER_HTTP="$(
  curl -sS -o "$LOG_DIR/dealer-order-create.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"deliveryAddressId\":\"$ADDRESS_ID\",
      \"productId\":\"$DEALER_PRODUCT_ID\",
      \"quantity\":1,
      \"notes\":\"Automated BonAgri dealer flow order\"
    }")"

if [[ "$DEALER_ORDER_HTTP" != "201" ]]; then
  cat "$LOG_DIR/dealer-order-create.json"
  fail "Buyer order for dealer listing failed. HTTP $DEALER_ORDER_HTTP"
fi

DEALER_ORDER_ID="$(
  python3 -c '
import json,sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
order = data.get("order") if isinstance(data.get("order"), dict) else data
print(order.get("id",""))
' "$LOG_DIR/dealer-order-create.json"
)"

echo "✓ Buyer ordered dealer listing: $DEALER_ORDER_ID"

curl -sS "$API_URL$API_PREFIX/orders/supplier" \
  -H "Authorization: Bearer $DEALER_TOKEN" > "$LOG_DIR/dealer-orders.json"

python3 - "$LOG_DIR/dealer-orders.json" "$DEALER_ORDER_ID" <<'PYJSON'
import json, sys

orders = json.load(open(sys.argv[1], encoding="utf-8"))
order_id = sys.argv[2]

if not any(o.get("id") == order_id for o in orders):
    raise SystemExit("ERROR: dealer cannot see the buyer's order on their queue")

print("✓ Dealer sees the order on their queue")
PYJSON

for transition in CONFIRMED PROCESSING READY_FOR_DELIVERY OUT_FOR_DELIVERY DELIVERED; do
  TRANSITION_HTTP="$(
    curl -sS -o "$LOG_DIR/dealer-transition.json" -w "%{http_code}" \
      -X PATCH "$API_URL$API_PREFIX/orders/$DEALER_ORDER_ID/status" \
      -H "Authorization: Bearer $DEALER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"$transition\"}")"

  if [[ "$TRANSITION_HTTP" != "200" ]]; then
    cat "$LOG_DIR/dealer-transition.json"
    fail "Dealer transition to $transition failed. HTTP $TRANSITION_HTTP"
  fi

  ACTUAL_STATUS="$(
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("status",""))' "$LOG_DIR/dealer-transition.json"
)"

  if [[ "$ACTUAL_STATUS" != "$transition" ]]; then
    fail "Dealer transition expected $transition, got $ACTUAL_STATUS"
  fi

  echo "✓ Dealer transitioned order → $transition"
done

curl -sS "$API_URL$API_PREFIX/orders/$DEALER_ORDER_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/dealer-order-final.json"

python3 - "$LOG_DIR/dealer-order-final.json" <<'PYJSON'
import json, sys

order = json.load(open(sys.argv[1], encoding="utf-8"))

if order.get("status") != "DELIVERED":
    raise SystemExit(
        "ERROR: expected buyer-visible DELIVERED, got {}".format(
            order.get("status")
        )
    )

print("✓ Buyer sees the dealer order as DELIVERED")
PYJSON

echo
echo "✓ DEALER FLOW ACCEPTANCE PASSED"

echo
echo "DISPUTE FLOW: RAISE → VENDOR → RESOLVE"
echo "========================================"

# Same guarded credential resolution as the admin section below (idempotent).
ADMIN_E2E_EMAIL="${ADMIN_E2E_EMAIL:-}"
ADMIN_E2E_PASSWORD="${ADMIN_E2E_PASSWORD:-}"

if [ -z "$ADMIN_E2E_PASSWORD" ] && [ -f "$API/.env" ]; then
  ADMIN_E2E_EMAIL="${ADMIN_E2E_EMAIL:-$(sed -n 's/^SEED_ADMIN_EMAIL=//p' "$API/.env" | tail -1)}"
  ADMIN_E2E_PASSWORD="$(sed -n 's/^SEED_ADMIN_PASSWORD=//p' "$API/.env" | tail -1 | tr -d "\"'" | tr -d '\r')"
fi

if [ -z "$ADMIN_E2E_EMAIL" ]; then
  ADMIN_E2E_EMAIL="admin@bonagri.co.za"
fi

if [ -z "$ADMIN_E2E_PASSWORD" ]; then
  echo "⚠ Dispute section SKIPPED: no SEED_ADMIN_PASSWORD in api/.env and no ADMIN_E2E_PASSWORD env var."
else

echo
echo "[E1/3] Buyer opens a dispute (guards + eligibility)..."

# Vendors cannot open disputes (BUYER-only route).
VENDOR_DISPUTE_HTTP="$(
  curl -sS -o "$LOG_DIR/dispute-vendor-open.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$ORDER_ID/dispute" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"reason\":\"DAMAGED\",\"description\":\"vendor trying to open a dispute\"}")"

if [[ "$VENDOR_DISPUTE_HTTP" != "403" ]]; then
  cat "$LOG_DIR/dispute-vendor-open.json"
  fail "Vendor was able to open a dispute. HTTP $VENDOR_DISPUTE_HTTP"
fi

echo "✓ Vendor cannot open disputes (403)"

# Anonymous requests are rejected before any dispute logic.
ANON_DISPUTE_HTTP="$(
  curl -sS -o "$LOG_DIR/dispute-anon.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$ORDER_ID/dispute" \
    -H "Content-Type: application/json" \
    -d "{\"reason\":\"OTHER\",\"description\":\"anonymous attempt\"}")"

if [[ "$ANON_DISPUTE_HTTP" != "401" ]]; then
  fail "Anonymous dispute attempt returned HTTP $ANON_DISPUTE_HTTP, expected 401"
fi

echo "✓ Anonymous dispute attempt rejected (401)"

# Disputes are only eligible from OUT_FOR_DELIVERY / DELIVERED.
# A fresh order stays PENDING: opening a dispute must fail with 400,
# then the buyer cancels it so the reservation is released again.
PENDING_ORDER_HTTP="$(
  curl -sS -o "$LOG_DIR/dispute-pending-order.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"productId\":\"$PRODUCT_ID\",\"quantity\":1,\"notes\":\"Dispute eligibility check\"}")"

if [[ "$PENDING_ORDER_HTTP" != "201" ]]; then
  cat "$LOG_DIR/dispute-pending-order.json"
  fail "Could not create the PENDING order for the dispute eligibility check. HTTP $PENDING_ORDER_HTTP"
fi

PENDING_ORDER_ID="$(
  python3 - "$LOG_DIR/dispute-pending-order.json" <<'PYJSON'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
order = data.get("order") if isinstance(data.get("order"), dict) else data
print(order.get("id", ""))
PYJSON
)"

if [[ -z "$PENDING_ORDER_ID" ]]; then
  fail "PENDING order identity missing in the dispute eligibility check."
fi

EARLY_DISPUTE_HTTP="$(
  curl -sS -o "$LOG_DIR/dispute-early.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$PENDING_ORDER_ID/dispute" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"reason\":\"NOT_DELIVERED\",\"description\":\"too early to dispute\"}")"

if [[ "$EARLY_DISPUTE_HTTP" != "400" ]]; then
  cat "$LOG_DIR/dispute-early.json"
  fail "Dispute on a PENDING order returned HTTP $EARLY_DISPUTE_HTTP, expected 400"
fi

echo "✓ Dispute rejected on a non-eligible (PENDING) order (400)"

CANCEL_DISPUTE_ORDER_HTTP="$(
  curl -sS -o "$LOG_DIR/dispute-cancel.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$PENDING_ORDER_ID/status" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"CANCELLED\"}")"

if [[ "$CANCEL_DISPUTE_ORDER_HTTP" != "200" ]]; then
  fail "Cleanup cancel of the throwaway order failed. HTTP $CANCEL_DISPUTE_ORDER_HTTP"
fi

echo "✓ Throwaway PENDING order cancelled (reservation released)"

# The delivered order from the buyer journey is eligible.
DISPUTE_HTTP="$(
  curl -sS -o "$LOG_DIR/dispute-create.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$ORDER_ID/dispute" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"reason\":\"DAMAGED\",\"description\":\"Two crates arrived bruised and unusable\"}")"

if [[ "$DISPUTE_HTTP" != "201" ]]; then
  cat "$LOG_DIR/dispute-create.json"
  fail "Buyer dispute creation failed. HTTP $DISPUTE_HTTP"
fi

DISPUTE_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/dispute-create.json"
)"

if [[ -z "$DISPUTE_ID" ]]; then
  fail "Dispute creation returned no dispute id."
fi

python3 - "$LOG_DIR/dispute-create.json" "$ORDER_ID" <<'PYJSON'
import json
import sys

dispute = json.load(open(sys.argv[1], encoding="utf-8"))

if dispute.get("status") != "OPEN":
    raise SystemExit("ERROR: new dispute expected OPEN, got {}".format(dispute.get("status")))

if (dispute.get("order") or {}).get("id") != sys.argv[2]:
    raise SystemExit("ERROR: dispute attached to the wrong order")

print("✓ Buyer opened a dispute on the delivered order")
PYJSON

# A second dispute on the same order must be rejected.
DUPLICATE_DISPUTE_HTTP="$(
  curl -sS -o "$LOG_DIR/dispute-duplicate.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$ORDER_ID/dispute" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"reason\":\"OTHER\",\"description\":\"second dispute attempt\"}")"

if [[ "$DUPLICATE_DISPUTE_HTTP" != "409" ]]; then
  cat "$LOG_DIR/dispute-duplicate.json"
  fail "Duplicate dispute returned HTTP $DUPLICATE_DISPUTE_HTTP, expected 409"
fi

echo "✓ Duplicate dispute rejected (409)"

# The platform-wide queue is admin-only.
BUYER_QUEUE_HTTP="$(
  curl -sS -o "$LOG_DIR/dispute-buyer-queue.json" -w "%{http_code}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API_URL$API_PREFIX/disputes")"

if [[ "$BUYER_QUEUE_HTTP" != "403" ]]; then
  fail "Buyer dispute-queue access returned HTTP $BUYER_QUEUE_HTTP, expected 403"
fi

echo "✓ Buyer cannot reach the admin dispute queue (403)"

# The vendor sees disputes on orders containing their products.
curl -sS "$API_URL$API_PREFIX/disputes/mine" \
  -H "Authorization: Bearer $SUPPLIER_TOKEN" > "$LOG_DIR/dispute-vendor-list.json"

python3 - "$LOG_DIR/dispute-vendor-list.json" "$DISPUTE_ID" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))
dispute_id = sys.argv[2]

if not isinstance(items, list):
    raise SystemExit("ERROR: vendor dispute list is not an array")

if not any(d.get("id") == dispute_id for d in items):
    raise SystemExit("ERROR: vendor cannot see the dispute for their order")

print("✓ Vendor sees the dispute on their queue")
PYJSON

# The dealer shares the vendor screen but has no disputed orders.
curl -sS "$API_URL$API_PREFIX/disputes/mine" \
  -H "Authorization: Bearer $DEALER_TOKEN" > "$LOG_DIR/dispute-dealer-list.json"

python3 - "$LOG_DIR/dispute-dealer-list.json" "$DISPUTE_ID" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))
dispute_id = sys.argv[2]

if not isinstance(items, list):
    raise SystemExit("ERROR: dealer dispute list is not an array")

if any(d.get("id") == dispute_id for d in items):
    raise SystemExit("ERROR: dealer can see a dispute on another vendor order")

print("✓ Dealer dispute list stays scoped to their own orders")
PYJSON

echo
echo "[E2/3] Admin resolves with a note; buyer sees the outcome; email captured..."

# HP2: two-step sign-in (password → pre-auth → TOTP) via the shared helper.
ADMIN_TOKEN="$(admin_login "$ADMIN_E2E_EMAIL" "$ADMIN_E2E_PASSWORD")"

if [[ -z "$ADMIN_TOKEN" ]]; then
  fail "Admin login for the dispute flow returned no access token"
fi

echo "✓ Admin login succeeded (two-step 2FA)"

curl -sS "$API_URL$API_PREFIX/disputes" \
  -H "Authorization: Bearer $ADMIN_TOKEN" > "$LOG_DIR/dispute-admin-list.json"

python3 - "$LOG_DIR/dispute-admin-list.json" "$DISPUTE_ID" "$ORDER_ID" "$TEST_EMAIL" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))
dispute_id = sys.argv[2]
order_id = sys.argv[3]
buyer_email = sys.argv[4]

if not isinstance(items, list):
    raise SystemExit("ERROR: admin dispute queue is not an array")

match = [d for d in items if d.get("id") == dispute_id]

if not match:
    raise SystemExit("ERROR: dispute missing from the admin queue")

dispute = match[0]
order = dispute.get("order") or {}

if order.get("id") != order_id:
    raise SystemExit("ERROR: admin queue shows the dispute on the wrong order")

if (dispute.get("openedBy") or {}).get("email") != buyer_email:
    raise SystemExit("ERROR: dispute opener does not match the buyer account")

if not order.get("history"):
    raise SystemExit("ERROR: admin queue dispute has no order-history evidence")

print("✓ Admin queue shows the dispute with order-history evidence")
PYJSON

RESOLVE_HTTP="$(
  curl -sS -o "$LOG_DIR/dispute-resolve.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/disputes/$DISPUTE_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"RESOLVED\",\"resolutionNote\":\"Two crates refunded; supplier advised on packaging standards\"}")"

if [[ "$RESOLVE_HTTP" != "200" ]]; then
  cat "$LOG_DIR/dispute-resolve.json"
  fail "Admin dispute resolution failed. HTTP $RESOLVE_HTTP"
fi

python3 - "$LOG_DIR/dispute-resolve.json" <<'PYJSON'
import json
import sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
dispute = result.get("dispute") or {}

if dispute.get("status") != "RESOLVED":
    raise SystemExit("ERROR: expected RESOLVED, got {}".format(dispute.get("status")))

if not dispute.get("resolutionNote"):
    raise SystemExit("ERROR: resolution note missing on the resolved dispute")

if not dispute.get("resolvedAt"):
    raise SystemExit("ERROR: resolvedAt missing on the resolved dispute")

print("✓ Admin resolved the dispute with a note")
PYJSON

# The resolution email must have been captured (mail capture mode).
if [[ ! -f "$DISPUTE_CAPTURE_FILE" ]]; then
  fail "Resolution email was not captured at $DISPUTE_CAPTURE_FILE"
fi

python3 - "$DISPUTE_CAPTURE_FILE" "$ORDER_NUMBER" <<'PYJSON'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
order_number = sys.argv[2]

if payload.get("orderNumber") != order_number:
    raise SystemExit("ERROR: captured resolution email references the wrong order")

if payload.get("outcome") != "RESOLVED":
    raise SystemExit("ERROR: captured resolution email outcome is {}".format(payload.get("outcome")))

if not payload.get("resolutionNote"):
    raise SystemExit("ERROR: captured resolution email has no note")

print("✓ Resolution email captured for the buyer")
PYJSON

# The buyer sees the resolution on the order detail.
curl -sS "$API_URL$API_PREFIX/orders/$ORDER_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/dispute-buyer-order.json"

python3 - "$LOG_DIR/dispute-buyer-order.json" "$DISPUTE_ID" <<'PYJSON'
import json
import sys

order = json.load(open(sys.argv[1], encoding="utf-8"))
dispute = order.get("dispute") or {}

if dispute.get("id") != sys.argv[2]:
    raise SystemExit("ERROR: buyer order detail is missing the dispute")

if dispute.get("status") != "RESOLVED":
    raise SystemExit("ERROR: buyer sees dispute status {}, expected RESOLVED".format(dispute.get("status")))

if not dispute.get("resolutionNote"):
    raise SystemExit("ERROR: buyer cannot see the resolution note")

print("✓ Buyer sees the resolved dispute and note on the order")
PYJSON

echo
echo "[E3/3] Closed disputes and role guards hold..."

# Closed disputes are terminal.
RECLOSE_HTTP="$(
  curl -sS -o "$LOG_DIR/dispute-reclose.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/disputes/$DISPUTE_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"REJECTED\",\"resolutionNote\":\"attempting to close twice\"}")"

if [[ "$RECLOSE_HTTP" != "400" ]]; then
  cat "$LOG_DIR/dispute-reclose.json"
  fail "Re-closing a closed dispute returned HTTP $RECLOSE_HTTP, expected 400"
fi

echo "✓ Closed dispute rejects further transitions (400)"

# Vendors and buyers cannot act on the admin queue.
VENDOR_PATCH_HTTP="$(
  curl -sS -o "$LOG_DIR/dispute-vendor-patch.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/disputes/$DISPUTE_ID" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"UNDER_REVIEW\"}")"

if [[ "$VENDOR_PATCH_HTTP" != "403" ]]; then
  fail "Vendor dispute update returned HTTP $VENDOR_PATCH_HTTP, expected 403"
fi

BUYER_PATCH_HTTP="$(
  curl -sS -o "$LOG_DIR/dispute-buyer-patch.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/disputes/$DISPUTE_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"UNDER_REVIEW\"}")"

if [[ "$BUYER_PATCH_HTTP" != "403" ]]; then
  fail "Buyer dispute update returned HTTP $BUYER_PATCH_HTTP, expected 403"
fi

echo "✓ Only admins can act on disputes (403 for vendor and buyer)"

echo
echo "✓ DISPUTE FLOW ACCEPTANCE PASSED"

fi

echo
echo "SELLER APPLICATION + NOTIFICATIONS FLOW"
echo "========================================"

if [ -z "$ADMIN_E2E_PASSWORD" ]; then
  echo "⚠ Glue section SKIPPED: no admin credentials available."
else

echo
echo "[F1/3] Fresh buyer applies to sell; admin sees the queue..."

# F uses its own registered + verified buyer so it never collides with
# the A2 promote journey (which targets the main smoke buyer).
F_EMAIL="cp6_buyer_$(date +%s)_$$@bonagri.local"
F_PASSWORD="$TEST_PASSWORD"

rm -f "$CAPTURE_FILE"

F_REGISTER_HTTP="$(
  curl -sS -o "$LOG_DIR/f-register.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$F_EMAIL\",\"password\":\"$F_PASSWORD\",\"firstName\":\"Glue\",\"lastName\":\"Tester\"}")"

if [[ "$F_REGISTER_HTTP" != "201" ]]; then
  cat "$LOG_DIR/f-register.json"
  fail "Glue-flow buyer registration failed. HTTP $F_REGISTER_HTTP"
fi

for _ in $(seq 1 30); do
  if [[ -s "$CAPTURE_FILE" ]]; then
    break
  fi
  sleep 0.5
done

if [[ ! -s "$CAPTURE_FILE" ]]; then
  fail "Glue-flow verification URL was not captured."
fi

F_VERIFY_TOKEN="$(cat "$CAPTURE_FILE")"
F_VERIFY_TOKEN="${F_VERIFY_TOKEN##*token=}"

F_VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/f-verify.json" -w "%{http_code}" \
    "$API_URL$API_PREFIX/auth/verify-email?token=$F_VERIFY_TOKEN")"

if [[ "$F_VERIFY_HTTP" != "200" && "$F_VERIFY_HTTP" != "201" ]]; then
  cat "$LOG_DIR/f-verify.json"
  fail "Glue-flow email verification failed. HTTP $F_VERIFY_HTTP"
fi

F_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/f-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$F_EMAIL" "$F_PASSWORD")"
)"

if [[ "$F_LOGIN_HTTP" != "201" ]]; then
  cat "$LOG_DIR/f-login.json"
  fail "Glue-flow buyer login failed. HTTP $F_LOGIN_HTTP"
fi

F_TOKEN="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("accessToken",""))' "$LOG_DIR/f-login.json"
)"

if [[ -z "$F_TOKEN" ]]; then
  fail "Glue-flow buyer login returned no access token"
fi

F_ADDRESS_HTTP="$(
  curl -sS -o "$LOG_DIR/f-address.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/addresses" \
    -H "Authorization: Bearer $F_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "label":"Glue Delivery Address",
      "recipientName":"Glue Tester",
      "phone":"+27820000009",
      "addressLine1":"1 Glue Test Street",
      "city":"Polokwane",
      "province":"Limpopo",
      "postalCode":"0700",
      "country":"South Africa",
      "isDefault":true
    }'
)"

if [[ "$F_ADDRESS_HTTP" != "201" ]]; then
  cat "$LOG_DIR/f-address.json"
  fail "Glue-flow address creation failed. HTTP $F_ADDRESS_HTTP"
fi

F_ADDRESS_ID="$(
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); a=d.get("address") if isinstance(d.get("address"),dict) else d; print(a.get("id",""))' "$LOG_DIR/f-address.json"
)"

if [[ -z "$F_ADDRESS_ID" ]]; then
  fail "Glue-flow address id missing."
fi

echo "✓ Glue-flow buyer registered, verified, logged in and has an address"

APPLY_HTTP="$(
  curl -sS -o "$LOG_DIR/app-create.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/seller-applications" \
    -H "Authorization: Bearer $F_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"desiredRole\":\"SUPPLIER\",\"businessName\":\"E2E Fresh Produce\",\"message\":\"Automated seller application\"}")"

if [[ "$APPLY_HTTP" != "201" ]]; then
  cat "$LOG_DIR/app-create.json"
  fail "Seller application creation failed. HTTP $APPLY_HTTP"
fi

APPLICATION_ID="$(
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); print(d.get("id","")); assert d.get("status")=="PENDING"' "$LOG_DIR/app-create.json"
)"

if [[ -z "$APPLICATION_ID" ]]; then
  fail "Seller application creation returned no id."
fi

echo "✓ Buyer applied to sell (PENDING)"

DUP_APPLY_HTTP="$(
  curl -sS -o "$LOG_DIR/app-dup.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/seller-applications" \
    -H "Authorization: Bearer $F_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"desiredRole\":\"SUPPLIER\",\"businessName\":\"E2E Fresh Produce duplicate\"}")"

if [[ "$DUP_APPLY_HTTP" != "409" ]]; then
  cat "$LOG_DIR/app-dup.json"
  fail "Duplicate seller application returned HTTP $DUP_APPLY_HTTP, expected 409"
fi

echo "✓ Duplicate application rejected (409)"

DEALER_APPLY_HTTP="$(
  curl -sS -o "$LOG_DIR/app-dealer.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/seller-applications" \
    -H "Authorization: Bearer $DEALER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"desiredRole\":\"SUPPLIER\",\"businessName\":\"Dealer applying again\"}")"

if [[ "$DEALER_APPLY_HTTP" != "403" ]]; then
  cat "$LOG_DIR/app-dealer.json"
  fail "Non-buyer seller application returned HTTP $DEALER_APPLY_HTTP, expected 403"
fi

echo "✓ Vendor accounts cannot apply (403)"

curl -sS "$API_URL$API_PREFIX/seller-applications/mine" \
  -H "Authorization: Bearer $F_TOKEN" > "$LOG_DIR/app-mine.json"

python3 - "$LOG_DIR/app-mine.json" "$APPLICATION_ID" <<'PYJSON'
import json
import sys

application = json.load(open(sys.argv[1], encoding="utf-8"))

if application.get("id") != sys.argv[2]:
    raise SystemExit("ERROR: /mine does not return the applicant own application")

if application.get("status") != "PENDING":
    raise SystemExit("ERROR: expected PENDING application")

print("✓ Applicant can check their own application status")
PYJSON

curl -sS "$API_URL$API_PREFIX/seller-applications" \
  -H "Authorization: Bearer $ADMIN_TOKEN" > "$LOG_DIR/app-queue.json"

python3 - "$LOG_DIR/app-queue.json" "$APPLICATION_ID" "$F_EMAIL" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))
application_id = sys.argv[2]
buyer_email = sys.argv[3]

match = [a for a in items if a.get("id") == application_id]

if not match:
    raise SystemExit("ERROR: application missing from the admin queue")

if (match[0].get("user") or {}).get("email") != sys.argv[3]:
    raise SystemExit("ERROR: queue application does not belong to the glue-flow buyer")

print("✓ Admin queue shows the application")
PYJSON

echo
echo "[F2/3] Order transitions notify the right people..."

NOTIFY_CAPTURE_FILE="$ROOT/.e2e/notifications.txt"

GLUE_ORDER_HTTP="$(
  curl -sS -o "$LOG_DIR/glue-order.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders" \
    -H "Authorization: Bearer $F_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$F_ADDRESS_ID\",\"productId\":\"$PRODUCT_ID\",\"quantity\":1,\"notes\":\"CP6 notification journey\"}")"

if [[ "$GLUE_ORDER_HTTP" != "201" ]]; then
  cat "$LOG_DIR/glue-order.json"
  fail "Glue-flow order creation failed. HTTP $GLUE_ORDER_HTTP"
fi

GLUE_ORDER_ID="$(
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); o=d.get("order") if isinstance(d.get("order"),dict) else d; print(o["id"])' "$LOG_DIR/glue-order.json"
)"
GLUE_ORDER_NUMBER="$(
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); o=d.get("order") if isinstance(d.get("order"),dict) else d; print(o["orderNumber"])' "$LOG_DIR/glue-order.json"
)"

CONFIRM_HTTP="$(
  curl -sS -o "$LOG_DIR/glue-confirm.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$GLUE_ORDER_ID/status" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"CONFIRMED\"}")"

if [[ "$CONFIRM_HTTP" != "200" ]]; then
  fail "Glue-flow confirm failed. HTTP $CONFIRM_HTTP"
fi

curl -sS "$API_URL$API_PREFIX/notifications" \
  -H "Authorization: Bearer $F_TOKEN" > "$LOG_DIR/notify-buyer.json"

python3 - "$LOG_DIR/notify-buyer.json" "$GLUE_ORDER_NUMBER" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))
number = sys.argv[2]

if not any(number in (n.get("title") or "") and "confirmed" in (n.get("title") or "").lower() for n in items):
    raise SystemExit("ERROR: buyer has no confirmation notification for the order")

print("✓ Buyer got the order-confirmed notification")
PYJSON

python3 - "$NOTIFY_CAPTURE_FILE" "$GLUE_ORDER_NUMBER" <<'PYJSON'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))

if sys.argv[2] not in payload.get("title", ""):
    raise SystemExit("ERROR: captured notification email is not the confirmation for this order")

print("✓ Confirmation email captured")
PYJSON

for transition in PROCESSING READY_FOR_DELIVERY OUT_FOR_DELIVERY DELIVERED; do
  GLUE_TRANSITION_HTTP="$(
    curl -sS -o "$LOG_DIR/glue-transition.json" -w "%{http_code}" \
      -X PATCH "$API_URL$API_PREFIX/orders/$GLUE_ORDER_ID/status" \
      -H "Authorization: Bearer $SUPPLIER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"$transition\"}")"

  if [[ "$GLUE_TRANSITION_HTTP" != "200" ]]; then
    fail "Glue-flow transition to $transition failed. HTTP $GLUE_TRANSITION_HTTP"
  fi
done

curl -sS "$API_URL$API_PREFIX/notifications" \
  -H "Authorization: Bearer $F_TOKEN" > "$LOG_DIR/notify-buyer.json"

python3 - "$LOG_DIR/notify-buyer.json" "$GLUE_ORDER_NUMBER" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))
number = sys.argv[2]

if not any(number in (n.get("title") or "") and "delivered" in (n.get("title") or "").lower() for n in items):
    raise SystemExit("ERROR: buyer has no delivery notification for the order")

print("✓ Buyer got the order-delivered notification")
PYJSON

python3 - "$NOTIFY_CAPTURE_FILE" "$GLUE_ORDER_NUMBER" <<'PYJSON'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))

if "delivered" not in payload.get("title", "").lower():
    raise SystemExit("ERROR: captured notification email is not the delivery one")

print("✓ Delivery email captured")
PYJSON

# Closing the dispute also notifies the buyer (row only - CP5 emailed).
GLUE_DISPUTE_HTTP="$(
  curl -sS -o "$LOG_DIR/glue-dispute.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$GLUE_ORDER_ID/dispute" \
    -H "Authorization: Bearer $F_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"reason\":\"WRONG_ITEM\",\"description\":\"Received the wrong crate size\"}")"

if [[ "$GLUE_DISPUTE_HTTP" != "201" ]]; then
  fail "Glue-flow dispute failed. HTTP $GLUE_DISPUTE_HTTP"
fi

GLUE_DISPUTE_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/glue-dispute.json"
)"

GLUE_RESOLVE_HTTP="$(
  curl -sS -o "$LOG_DIR/glue-resolve.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/disputes/$GLUE_DISPUTE_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"RESOLVED\",\"resolutionNote\":\"Wrong crate replaced; buyer compensated\"}")"

if [[ "$GLUE_RESOLVE_HTTP" != "200" ]]; then
  fail "Glue-flow dispute resolution failed. HTTP $GLUE_RESOLVE_HTTP"
fi

curl -sS "$API_URL$API_PREFIX/notifications" \
  -H "Authorization: Bearer $F_TOKEN" > "$LOG_DIR/notify-buyer.json"

python3 - "$LOG_DIR/notify-buyer.json" "$GLUE_ORDER_NUMBER" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))
number = sys.argv[2]

if not any(number in (n.get("title") or "") and "dispute" in (n.get("title") or "").lower() for n in items):
    raise SystemExit("ERROR: buyer has no dispute-resolution notification")

print("✓ Buyer got the dispute-resolution notification")
PYJSON

echo
echo "[F3/3] Admin approval promotes the role exactly once..."

APPROVE_HTTP="$(
  curl -sS -o "$LOG_DIR/app-approve.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/seller-applications/$APPLICATION_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"APPROVED\",\"note\":\"Welcome to BonAgri\"}")"

if [[ "$APPROVE_HTTP" != "200" ]]; then
  cat "$LOG_DIR/app-approve.json"
  fail "Seller application approval failed. HTTP $APPROVE_HTTP"
fi

python3 - "$LOG_DIR/app-approve.json" <<'PYJSON'
import json
import sys

application = json.load(open(sys.argv[1], encoding="utf-8"))

if application.get("status") != "APPROVED":
    raise SystemExit("ERROR: expected APPROVED application")

print("✓ Application approved")
PYJSON

REAPPROVE_HTTP="$(
  curl -sS -o "$LOG_DIR/app-reapprove.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/seller-applications/$APPLICATION_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"APPROVED\",\"note\":\"again\"}")"

if [[ "$REAPPROVE_HTTP" != "409" ]]; then
  cat "$LOG_DIR/app-reapprove.json"
  fail "Re-approval returned HTTP $REAPPROVE_HTTP, expected 409 (promote exactly once)"
fi

echo "✓ Second approval rejected (409) - promotion happens exactly once"

PROMOTED_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/promoted-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$F_EMAIL" "$F_PASSWORD")"
)"

if [[ "$PROMOTED_LOGIN_HTTP" != "201" ]]; then
  cat "$LOG_DIR/promoted-login.json"
  fail "Promoted user re-login failed. HTTP $PROMOTED_LOGIN_HTTP"
fi

PROMOTED_TOKEN="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("accessToken",""))' "$LOG_DIR/promoted-login.json"
)"

curl -sS "$API_URL$API_PREFIX/auth/me" \
  -H "Authorization: Bearer $PROMOTED_TOKEN" > "$LOG_DIR/promoted-me.json"

python3 - "$LOG_DIR/promoted-me.json" <<'PYJSON'
import json
import sys

me = json.load(open(sys.argv[1], encoding="utf-8"))

if me.get("role") != "SUPPLIER":
    raise SystemExit("ERROR: promoted user role is {}, expected SUPPLIER".format(me.get("role")))

print("✓ Applicant re-logs-in as SUPPLIER")
PYJSON

VENDOR_QUEUE_CODE="$(
  curl -sS -o "$LOG_DIR/promoted-vendor-queue.json" -w "%{http_code}" \
    -H "Authorization: Bearer $PROMOTED_TOKEN" \
    "$API_URL$API_PREFIX/orders/supplier")"

if [[ "$VENDOR_QUEUE_CODE" != "200" ]]; then
  fail "Promoted user cannot load the vendor order queue. HTTP $VENDOR_QUEUE_CODE"
fi

echo "✓ Promoted user loads the vendor hub (GET /orders/supplier -> 200)"

curl -sS "$API_URL$API_PREFIX/notifications" \
  -H "Authorization: Bearer $PROMOTED_TOKEN" > "$LOG_DIR/promoted-notifications.json"

python3 - "$LOG_DIR/promoted-notifications.json" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))

if not any("approved" in (n.get("title") or "").lower() for n in items):
    raise SystemExit("ERROR: promoted user has no approval notification")

print("✓ Applicant was notified of the approval")
PYJSON

echo
echo "✓ GLUE + SELF-SERVICE FLOW ACCEPTANCE PASSED"

fi

echo
echo "PRODUCT REQUESTS FLOW"
echo "====================="

echo
echo "[G1/3] Buyer posts a request; the public demand board shows it..."

# G reuses the main smoke buyer, which is still a BUYER at this point
# (F promotes its own separate account; A2 promotes the main buyer later).

G_FUTURE_DATE="$(date -v+14d +%Y-%m-%d 2>/dev/null || date -d '+14 days' +%Y-%m-%d)"
SMOKE_G_TITLE="Smoke Buyer Demand $(date +%s)"

G_CREATE_HTTP="$(
  curl -sS -o "$LOG_DIR/g-request.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"$SMOKE_G_TITLE\",\"quantity\":250,\"unit\":\"kg\",\"destinationCity\":\"Polokwane\",\"requiredBy\":\"$G_FUTURE_DATE\",\"notes\":\"Automated CP7 request\"}")"

if [[ "$G_CREATE_HTTP" != "201" ]]; then
  cat "$LOG_DIR/g-request.json"
  fail "Product request creation failed. HTTP $G_CREATE_HTTP"
fi

G_REQUEST_ID="$(
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); print(d.get("id","")); assert d.get("status")=="OPEN"' "$LOG_DIR/g-request.json"
)"

if [[ -z "$G_REQUEST_ID" ]]; then
  fail "Product request creation returned no id."
fi

G_PAST_HTTP="$(
  curl -sS -o "$LOG_DIR/g-request-past.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"Past demand\",\"quantity\":1,\"unit\":\"kg\",\"requiredBy\":\"2020-01-01\"}")"

if [[ "$G_PAST_HTTP" != "400" ]]; then
  fail "Past requiredBy returned HTTP $G_PAST_HTTP, expected 400"
fi

echo "✓ Request created OPEN; past requiredBy rejected (400)"

# Public board: NO auth header at all.
curl -sS "$API_URL$API_PREFIX/product-requests" > "$LOG_DIR/g-public.json"

python3 - "$LOG_DIR/g-public.json" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))

if not isinstance(items, list) or not items:
    raise SystemExit("ERROR: public demand board is empty")

first = items[0]
if "buyer" in first or "buyerId" in first:
    raise SystemExit("ERROR: public board leaks buyer identity")

print("✓ Public demand board reachable without auth and leaks no buyer identity")
PYJSON

python3 - "$LOG_DIR/g-public.json" "$SMOKE_G_TITLE" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))
title = sys.argv[2]

if not any(i.get("title") == title for i in items):
    raise SystemExit("ERROR: created request missing from the public board")

print("✓ Created request visible on the public demand board")
PYJSON

curl -sS "$API_URL$API_PREFIX/product-requests/mine" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/g-mine.json"

python3 - "$LOG_DIR/g-mine.json" "$G_REQUEST_ID" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))

if not any(i.get("id") == sys.argv[2] for i in items):
    raise SystemExit("ERROR: created request missing from /mine")

print("✓ Buyer sees the request under /mine")
PYJSON

echo
echo "[G2/3] Role guards hold..."

G_ANON_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"Anon\",\"quantity\":1,\"unit\":\"kg\"}")"

if [[ "$G_ANON_HTTP" != "401" ]]; then
  fail "Anonymous request creation returned HTTP $G_ANON_HTTP, expected 401"
fi

G_VENDOR_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests" \
    -H "Authorization: Bearer $DEALER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"Vendor\",\"quantity\":1,\"unit\":\"kg\"}")"

if [[ "$G_VENDOR_HTTP" != "403" ]]; then
  fail "Vendor request creation returned HTTP $G_VENDOR_HTTP, expected 403"
fi

G_FOREIGN_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/product-requests/00000000-0000-4000-8000-000000000000" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"WITHDRAWN\"}")"

if [[ "$G_FOREIGN_HTTP" != "404" ]]; then
  fail "Withdraw of a missing request returned HTTP $G_FOREIGN_HTTP, expected 404"
fi

echo "✓ Anon 401, vendor 403, missing-request withdraw 404"

echo
echo "[G3/3] Withdraw moves it off the board and closes the lifecycle..."

G_WITHDRAW_HTTP="$(
  curl -sS -o "$LOG_DIR/g-withdraw.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/product-requests/$G_REQUEST_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"WITHDRAWN\"}")"

if [[ "$G_WITHDRAW_HTTP" != "200" ]]; then
  cat "$LOG_DIR/g-withdraw.json"
  fail "Request withdraw failed. HTTP $G_WITHDRAW_HTTP"
fi

G_REWITHDRAW_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/product-requests/$G_REQUEST_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"FULFILLED\"}")"

if [[ "$G_REWITHDRAW_HTTP" != "409" ]]; then
  fail "Transition out of WITHDRAWN returned HTTP $G_REWITHDRAW_HTTP, expected 409"
fi

curl -sS "$API_URL$API_PREFIX/product-requests" > "$LOG_DIR/g-public-after.json"

python3 - "$LOG_DIR/g-public-after.json" "$SMOKE_G_TITLE" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))
title = sys.argv[2]

if any(i.get("title") == title for i in items):
    raise SystemExit("ERROR: withdrawn request still on the public board")

print("✓ Withdrawn request no longer on the public demand board")
PYJSON

curl -sS "$API_URL$API_PREFIX/product-requests/mine" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/g-mine-after.json"

python3 - "$LOG_DIR/g-mine-after.json" "$G_REQUEST_ID" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))
match = [i for i in items if i.get("id") == sys.argv[2]]

if not match or match[0].get("status") != "WITHDRAWN":
    raise SystemExit("ERROR: /mine does not show the withdrawn request")

print("✓ /mine shows the WITHDRAWN status")
PYJSON

echo
echo "[web] request + apply routes respond..."

for web_route in "/requests" "/apply"; do
  WEB_ROUTE_CODE="$(
    curl -sS -m 90 -o /dev/null -w "%{http_code}" "$WEB_URL$web_route")"

  if [[ "$WEB_ROUTE_CODE" != "200" ]]; then
    fail "Web route $web_route returned HTTP $WEB_ROUTE_CODE"
  fi

  echo "✓ Web route $web_route -> 200"
done

echo
echo "✓ PRODUCT REQUESTS FLOW ACCEPTANCE PASSED"

echo
echo "REQUEST RESPONSE FLOW"
echo "====================="

echo
echo "[H1/3] Vendor responds; buyer sees it and accepts..."

H_FUTURE_DATE="$(date -v+14d +%Y-%m-%d 2>/dev/null || date -d '+14 days' +%Y-%m-%d)"
H_TITLE="Smoke Response Demand $(date +%s)"

H_CREATE_HTTP="$(
  curl -sS -o "$LOG_DIR/h-request.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"$H_TITLE\",\"quantity\":800,\"unit\":\"kg\",\"destinationCity\":\"Polokwane\",\"requiredBy\":\"$H_FUTURE_DATE\"}")"

if [[ "$H_CREATE_HTTP" != "201" ]]; then
  fail "H request creation failed. HTTP $H_CREATE_HTTP"
fi

H_REQUEST_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/h-request.json")"

if [[ -z "$H_REQUEST_ID" ]]; then
  fail "H request creation returned no id."
fi

H_RESPOND_HTTP="$(
  curl -sS -o "$LOG_DIR/h-respond.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests/$H_REQUEST_ID/responses" \
    -H "Authorization: Bearer $DEALER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"We can supply this from our Polokwane depot\",\"productId\":\"$DEALER_PRODUCT_ID\",\"quotedPrice\":12.5,\"quotedUnit\":\"per kg\"}")"

if [[ "$H_RESPOND_HTTP" != "201" ]]; then
  cat "$LOG_DIR/h-respond.json"
  fail "Vendor response failed. HTTP $H_RESPOND_HTTP"
fi

H_RESPONSE_ID="$(
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); print(d.get("id","")); assert d.get("status")=="OPEN"' "$LOG_DIR/h-respond.json")"

if [[ -z "$H_RESPONSE_ID" ]]; then
  fail "Vendor response returned no id."
fi

H_DUP_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests/$H_REQUEST_ID/responses" \
    -H "Authorization: Bearer $DEALER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"Second try\",\"productId\":\"$DEALER_PRODUCT_ID\"}")"

if [[ "$H_DUP_HTTP" != "409" ]]; then
  fail "Duplicate response returned HTTP $H_DUP_HTTP, expected 409"
fi

curl -sS "$API_URL$API_PREFIX/product-requests/$H_REQUEST_ID/responses" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/h-responses.json"

python3 - "$LOG_DIR/h-responses.json" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))

if not items or items[0].get("status") != "OPEN":
    raise SystemExit("ERROR: buyer does not see the OPEN response")

supplier = items[0].get("supplier") or {}

if not supplier.get("businessName") or "id" in supplier:
    raise SystemExit("ERROR: response payload missing businessName or leaks ids")

print("OK Buyer sees the response with the vendor business name")
PYJSON

H_ACCEPT_HTTP="$(
  curl -sS -o "$LOG_DIR/h-accept.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/product-requests/responses/$H_RESPONSE_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"ACCEPTED\"}")"

if [[ "$H_ACCEPT_HTTP" != "200" ]]; then
  cat "$LOG_DIR/h-accept.json"
  fail "Response accept failed. HTTP $H_ACCEPT_HTTP"
fi

curl -sS "$API_URL$API_PREFIX/product-requests/responses/mine" \
  -H "Authorization: Bearer $DEALER_TOKEN" > "$LOG_DIR/h-mine.json"

python3 - "$LOG_DIR/h-mine.json" "$H_REQUEST_ID" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))
match = [i for i in items if i.get("request", {}).get("id") == sys.argv[2]]

if not match or match[0].get("status") != "ACCEPTED":
    raise SystemExit("ERROR: vendor /responses/mine does not show ACCEPTED")

print("OK Vendor sees ACCEPTED under /responses/mine")
PYJSON

echo
echo "[H2/3] Role and ownership guards hold..."

H_ANON_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests/$H_REQUEST_ID/responses" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"anon\"}")"

if [[ "$H_ANON_HTTP" != "401" ]]; then
  fail "Anonymous respond returned HTTP $H_ANON_HTTP, expected 401"
fi

H_BUYER_RESPOND_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests/$H_REQUEST_ID/responses" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"buyer responds\"}")"

if [[ "$H_BUYER_RESPOND_HTTP" != "403" ]]; then
  fail "Buyer respond returned HTTP $H_BUYER_RESPOND_HTTP, expected 403"
fi

H_VENDOR_READ_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    "$API_URL$API_PREFIX/product-requests/$H_REQUEST_ID/responses" \
    -H "Authorization: Bearer $DEALER_TOKEN")"

if [[ "$H_VENDOR_READ_HTTP" != "403" ]]; then
  fail "Vendor reading buyer responses returned HTTP $H_VENDOR_READ_HTTP, expected 403"
fi

H_UNKNOWN_READ_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    "$API_URL$API_PREFIX/product-requests/00000000-0000-4000-8000-000000000000/responses" \
    -H "Authorization: Bearer $ACCESS_TOKEN")"

if [[ "$H_UNKNOWN_READ_HTTP" != "404" ]]; then
  fail "Buyer reading unknown request responses returned HTTP $H_UNKNOWN_READ_HTTP, expected 404"
fi

H_BUYER_WITHDRAW_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/product-requests/responses/$H_RESPONSE_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"WITHDRAWN\"}")"

if [[ "$H_BUYER_WITHDRAW_HTTP" != "404" ]]; then
  fail "Buyer withdrawing a vendor response returned HTTP $H_BUYER_WITHDRAW_HTTP, expected 404"
fi

H_VENDOR_REACT_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/product-requests/responses/$H_RESPONSE_ID" \
    -H "Authorization: Bearer $DEALER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"WITHDRAWN\"}")"

if [[ "$H_VENDOR_REACT_HTTP" != "409" ]]; then
  fail "Vendor withdrawing their own ACCEPTED response returned HTTP $H_VENDOR_REACT_HTTP, expected 409"
fi

H_ACT_TWICE_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/product-requests/responses/$H_RESPONSE_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"DECLINED\"}")"

if [[ "$H_ACT_TWICE_HTTP" != "409" ]]; then
  fail "Acting on a non-OPEN response returned HTTP $H_ACT_TWICE_HTTP, expected 409"
fi

echo "OK Anon 401, buyer respond 403, vendor read 403, unknown read 404, wrong-actor 404, re-act 409"

echo
echo "[H3/3] Accepting auto-declines competing responses..."

H2_TITLE="Smoke Response Race $(date +%s)"

H2_CREATE_HTTP="$(
  curl -sS -o "$LOG_DIR/h2-request.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"$H2_TITLE\",\"quantity\":50,\"unit\":\"crates\"}")"

if [[ "$H2_CREATE_HTTP" != "201" ]]; then
  fail "H2 request creation failed. HTTP $H2_CREATE_HTTP"
fi

H2_REQUEST_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/h2-request.json")"

for H2_TOKEN_VAR in SUPPLIER_TOKEN DEALER_TOKEN
do
  eval "H2_TOKEN=\$$H2_TOKEN_VAR"

  # F1: each quote is backed by that actor's own ACTIVE listing.
  if [[ "$H2_TOKEN_VAR" == "SUPPLIER_TOKEN" ]]; then
    H2_PRODUCT_ID="$PRODUCT_ID"
  else
    H2_PRODUCT_ID="$DEALER_PRODUCT_ID"
  fi

  H2_RESPOND_HTTP="$(
    curl -sS -o "$LOG_DIR/h2-respond-$H2_TOKEN_VAR.json" -w "%{http_code}" \
      -X POST "$API_URL$API_PREFIX/product-requests/$H2_REQUEST_ID/responses" \
      -H "Authorization: Bearer $H2_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"message\":\"We can cover this demand\",\"productId\":\"$H2_PRODUCT_ID\"}")"

  if [[ "$H2_RESPOND_HTTP" != "201" ]]; then
    fail "H2 respond as $H2_TOKEN_VAR failed. HTTP $H2_RESPOND_HTTP"
  fi
done

H2_DEV_RESPONSE_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/h2-respond-SUPPLIER_TOKEN.json")"
H2_DEALER_RESPONSE_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/h2-respond-DEALER_TOKEN.json")"

H2_ACCEPT_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/product-requests/responses/$H2_DEV_RESPONSE_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"ACCEPTED\"}")"

if [[ "$H2_ACCEPT_HTTP" != "200" ]]; then
  fail "H2 accept failed. HTTP $H2_ACCEPT_HTTP"
fi

curl -sS "$API_URL$API_PREFIX/product-requests/$H2_REQUEST_ID/responses" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/h2-responses-after.json"

python3 - "$LOG_DIR/h2-responses-after.json" "$H2_DEV_RESPONSE_ID" "$H2_DEALER_RESPONSE_ID" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))
by_id = {i.get("id"): i.get("status") for i in items}

if by_id.get(sys.argv[2]) != "ACCEPTED":
    raise SystemExit("ERROR: chosen response is not ACCEPTED")

if by_id.get(sys.argv[3]) != "DECLINED":
    raise SystemExit("ERROR: competing response was not auto-declined")

print("OK Accept auto-declined the competing response")
PYJSON

H2_WITHDRAW_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/product-requests/$H2_REQUEST_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"WITHDRAWN\"}")"

if [[ "$H2_WITHDRAW_HTTP" != "200" ]]; then
  fail "H2 request withdraw failed. HTTP $H2_WITHDRAW_HTTP"
fi

H2_LATE_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests/$H2_REQUEST_ID/responses" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"late\",\"productId\":\"$PRODUCT_ID\"}")"

if [[ "$H2_LATE_HTTP" != "409" ]]; then
  fail "Responding to a withdrawn request returned HTTP $H2_LATE_HTTP, expected 409"
fi

echo "OK Late response on a withdrawn request rejected (409)"

echo
echo "✓ REQUEST RESPONSE FLOW ACCEPTANCE PASSED"

echo
echo "VERIFICATION GATES (CP17)"
echo "========================================"

# CP17: browsing stays open, moving money is gated. The main smoke buyer is
# registered fresh (never phone-verified), so cart checkout must refuse
# until the emailed OTP is confirmed — the same flow the web checkout uses.

echo
echo "[V1/8] Cart checkout refuses an unverified phone number..."

V_TS="$(date +%s)"
V_SLUG="cp17-verify-$V_TS"
V_SKU="BON-CP17-$V_TS"

V_PRODUCT_HTTP="$(
  curl -sS -o "$LOG_DIR/v-product.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/products" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"categoryId\":\"$SMOKE_CATEGORY_ID\",\"name\":\"CP17 Verify Tomato\",\"slug\":\"$V_SLUG\",\"sku\":\"$V_SKU\",\"price\":9,\"unit\":\"kg\",\"quantity\":5,\"status\":\"ACTIVE\"}")"

if [[ "$V_PRODUCT_HTTP" != "200" && "$V_PRODUCT_HTTP" != "201" ]]; then
  cat "$LOG_DIR/v-product.json"
  fail "Verification-section product creation failed. HTTP $V_PRODUCT_HTTP"
fi

V_PRODUCT_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/v-product.json")"

rm -f "$OTP_CAPTURE_FILE"

V_ADD_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/cart/items" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"productId\":\"$V_PRODUCT_ID\",\"quantity\":1}")"

if [[ "$V_ADD_HTTP" != "201" ]]; then
  fail "Adding the verification product to cart failed. HTTP $V_ADD_HTTP"
fi

V_GATE_HTTP="$(
  curl -sS -o "$LOG_DIR/v-gate.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/cart/checkout" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"notes\":\"CP17 phone gate\"}")"

if [[ "$V_GATE_HTTP" != "403" ]]; then
  cat "$LOG_DIR/v-gate.json"
  fail "Checkout without a verified phone should be 403, got HTTP $V_GATE_HTTP"
fi

python3 - "$LOG_DIR/v-gate.json" <<'PYJSON'
import json
import sys

body = json.load(open(sys.argv[1], encoding="utf-8"))

if body.get("code") != "PHONE_VERIFICATION_REQUIRED":
    raise SystemExit("ERROR: expected PHONE_VERIFICATION_REQUIRED, got {}".format(body.get("code")))

print("✓ Checkout refused with PHONE_VERIFICATION_REQUIRED (403)")
PYJSON

echo
echo "[V2/8] OTP send -> emailed code -> cooldown guard -> confirm..."

V_SEND_HTTP="$(
  curl -sS -o "$LOG_DIR/v-send.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/verification/phone/send" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"phone":"+2771234567"}')"

if [[ "$V_SEND_HTTP" != "200" && "$V_SEND_HTTP" != "201" ]]; then
  cat "$LOG_DIR/v-send.json"
  fail "Phone OTP send failed. HTTP $V_SEND_HTTP"
fi

for _ in $(seq 1 30); do
  if [[ -s "$OTP_CAPTURE_FILE" ]]; then
    break
  fi
  sleep 0.5
done

if [[ ! -s "$OTP_CAPTURE_FILE" ]]; then
  fail "Phone OTP was not captured at $OTP_CAPTURE_FILE"
fi

V_OTP_CODE="$(tr -dc '0-9' < "$OTP_CAPTURE_FILE")"

if [[ "${#V_OTP_CODE}" -ne 6 ]]; then
  fail "Captured OTP is not a 6-digit code: '$V_OTP_CODE'"
fi

echo "✓ 6-digit OTP captured from the mail capture file"

# A resend inside the 60s per-user cooldown is refused before the live code
# is invalidated, so this must not disturb the code we just captured.
V_COOLDOWN_HTTP="$(
  curl -sS -o "$LOG_DIR/v-cooldown.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/verification/phone/send" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"phone":"+2771234567"}')"

if [[ "$V_COOLDOWN_HTTP" != "429" ]]; then
  cat "$LOG_DIR/v-cooldown.json"
  fail "OTP resend inside the cooldown should be 429, got HTTP $V_COOLDOWN_HTTP"
fi

python3 - "$LOG_DIR/v-cooldown.json" <<'PYJSON'
import json
import sys

body = json.load(open(sys.argv[1], encoding="utf-8"))

if body.get("code") != "OTP_COOLDOWN":
    raise SystemExit("ERROR: expected OTP_COOLDOWN, got {}".format(body.get("code")))

print("✓ Resend inside cooldown refused (429 OTP_COOLDOWN)")
PYJSON

V_CONFIRM_HTTP="$(
  curl -sS -o "$LOG_DIR/v-confirm.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/verification/phone/confirm" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"code\":\"$V_OTP_CODE\"}")"

if [[ "$V_CONFIRM_HTTP" != "200" && "$V_CONFIRM_HTTP" != "201" ]]; then
  cat "$LOG_DIR/v-confirm.json"
  fail "Phone OTP confirm failed. HTTP $V_CONFIRM_HTTP"
fi

curl -sS "$API_URL$API_PREFIX/verification/me" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/v-me.json"

python3 - "$LOG_DIR/v-me.json" <<'PYJSON'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
phone = data.get("phone") or {}
business = data.get("business") or {}

if not phone.get("verified"):
    raise SystemExit("ERROR: summary still reports an unverified phone")

if business.get("status") != "NOT_STARTED":
    raise SystemExit("ERROR: buyer business status should stay NOT_STARTED, got {}".format(business.get("status")))

print("✓ Summary: phone verified, business status untouched (NOT_STARTED)")
PYJSON

echo
echo "[V3/8] The same checkout now succeeds..."

V_CHECKOUT_HTTP="$(
  curl -sS -o "$LOG_DIR/v-checkout.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/cart/checkout" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"notes\":\"CP17 phone gate open\"}")"

if [[ "$V_CHECKOUT_HTTP" != "200" && "$V_CHECKOUT_HTTP" != "201" ]]; then
  cat "$LOG_DIR/v-checkout.json"
  fail "Checkout after phone confirmation failed. HTTP $V_CHECKOUT_HTTP"
fi

echo "✓ Checkout succeeded once the phone was verified"

# CP17 business verification: the promoted applicant from the glue flow is a
# SUPPLIER whose business verification has never been reviewed. Drafts stay
# free; publishing, accepting orders and the admin review path are all
# refused until an admin approves an application.
if [ -n "${PROMOTED_TOKEN:-}" ]; then

echo
echo "[V4/8] Unverified supplier: drafts are free, publishing is refused..."

V_DRAFT_HTTP="$(
  curl -sS -o "$LOG_DIR/v-draft.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/products" \
    -H "Authorization: Bearer $PROMOTED_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"categoryId\":\"$SMOKE_CATEGORY_ID\",\"name\":\"CP17 Legacy Listing\",\"slug\":\"cp17-legacy-$V_TS\",\"sku\":\"BON-CP17-L-$V_TS\",\"price\":7,\"unit\":\"kg\",\"quantity\":5,\"status\":\"DRAFT\"}")"

if [[ "$V_DRAFT_HTTP" != "200" && "$V_DRAFT_HTTP" != "201" ]]; then
  cat "$LOG_DIR/v-draft.json"
  fail "Draft creation for an unverified supplier failed. HTTP $V_DRAFT_HTTP"
fi

V_DRAFT_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/v-draft.json")"

V_PUBLISH_HTTP="$(
  curl -sS -o "$LOG_DIR/v-publish.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/products" \
    -H "Authorization: Bearer $PROMOTED_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"categoryId\":\"$SMOKE_CATEGORY_ID\",\"name\":\"CP17 Publish Refused\",\"slug\":\"cp17-publish-$V_TS\",\"sku\":\"BON-CP17-P-$V_TS\",\"price\":7,\"unit\":\"kg\",\"quantity\":5,\"status\":\"ACTIVE\"}")"

if [[ "$V_PUBLISH_HTTP" != "403" ]]; then
  cat "$LOG_DIR/v-publish.json"
  fail "ACTIVE create by an unverified supplier should be 403, got HTTP $V_PUBLISH_HTTP"
fi

python3 - "$LOG_DIR/v-publish.json" <<'PYJSON'
import json
import sys

body = json.load(open(sys.argv[1], encoding="utf-8"))

if body.get("code") != "BUSINESS_VERIFICATION_REQUIRED":
    raise SystemExit("ERROR: expected BUSINESS_VERIFICATION_REQUIRED, got {}".format(body.get("code")))

print("✓ ACTIVE create refused with BUSINESS_VERIFICATION_REQUIRED (403)")
PYJSON

# Model the CP17 rollout case: a listing that is already live because the
# account predates the verification system (no production migration ran, so
# legacy owners stay NOT_STARTED). Flip the draft straight to ACTIVE in the
# database — the API would (correctly) refuse to do it for this owner.
psql "${E2E_PSQL_TARGET:-bonagri}" -v ON_ERROR_STOP=1 -q \
  -v pid="$V_DRAFT_ID" <<'SQL'
UPDATE "Product" SET "status" = 'ACTIVE' WHERE id = :'pid';
SQL

echo "✓ Legacy listing simulated (DRAFT -> ACTIVE in the database)"

echo
echo "[V5/8] Accepting an order and reaching the admin path stay refused..."

V_ORDER_HTTP="$(
  curl -sS -o "$LOG_DIR/v-order.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"productId\":\"$V_DRAFT_ID\",\"quantity\":1,\"notes\":\"CP17 business gate\"}")"

if [[ "$V_ORDER_HTTP" != "201" ]]; then
  cat "$LOG_DIR/v-order.json"
  fail "Buyer order on the legacy listing failed. HTTP $V_ORDER_HTTP"
fi

V_ORDER_ID="$(
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); o=d.get("order") if isinstance(d.get("order"),dict) else d; print(o.get("id",""))' "$LOG_DIR/v-order.json")"

if [[ -z "$V_ORDER_ID" ]]; then
  fail "Order id missing from the order creation response."
fi

V_ACCEPT_GATE_HTTP="$(
  curl -sS -o "$LOG_DIR/v-accept-gate.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$V_ORDER_ID/status" \
    -H "Authorization: Bearer $PROMOTED_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"CONFIRMED"}')"

if [[ "$V_ACCEPT_GATE_HTTP" != "403" ]]; then
  cat "$LOG_DIR/v-accept-gate.json"
  fail "Accept by an unverified supplier should be 403, got HTTP $V_ACCEPT_GATE_HTTP"
fi

python3 - "$LOG_DIR/v-accept-gate.json" <<'PYJSON'
import json
import sys

body = json.load(open(sys.argv[1], encoding="utf-8"))

if body.get("code") != "BUSINESS_VERIFICATION_REQUIRED":
    raise SystemExit("ERROR: expected BUSINESS_VERIFICATION_REQUIRED, got {}".format(body.get("code")))

print("✓ Order accept refused with BUSINESS_VERIFICATION_REQUIRED (403)")
PYJSON

# The applicant can never approve itself: the admin queue is unreachable
# from a supplier token (JWT + ADMIN role guard).
V_SELF_HTTP="$(
  curl -sS -o "$LOG_DIR/v-self.json" -w "%{http_code}" \
    -H "Authorization: Bearer $PROMOTED_TOKEN" \
    "$API_URL$API_PREFIX/admin/verification/applications")"

if [[ "$V_SELF_HTTP" != "403" ]]; then
  cat "$LOG_DIR/v-self.json"
  fail "Supplier reading the admin verification queue should be 403, got HTTP $V_SELF_HTTP"
fi

echo "✓ Applicant cannot reach the admin review path (403)"

echo
echo "[V6/8] Supplier submits a business application with documents..."

V_SUBMIT_PAYLOAD="$(printf '%s' "{\"businessName\":\"CP17 Smoke Traders\",\"contactPhone\":\"+2771234567\",\"physicalAddress\":\"1 Smoke Street, Polokwane, 0700\",\"representativeName\":\"Smoke Tester\",\"documents\":[{\"kind\":\"BUSINESS_REGISTRATION\",\"publicId\":\"bonagri/verification/cp17-smoke-doc-01\",\"fileName\":\"cipc-certificate.pdf\",\"mimeType\":\"application/pdf\",\"sizeBytes\":2048}]}")"

V_SUBMIT_HTTP="$(
  curl -sS -o "$LOG_DIR/v-submit.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/verification/applications" \
    -H "Authorization: Bearer $PROMOTED_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$V_SUBMIT_PAYLOAD")"

if [[ "$V_SUBMIT_HTTP" != "201" ]]; then
  cat "$LOG_DIR/v-submit.json"
  fail "Verification application submission failed. HTTP $V_SUBMIT_HTTP"
fi

V_APP_ID="$(
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); assert d.get("status")=="PENDING", d.get("status"); print(d.get("id",""))' "$LOG_DIR/v-submit.json")"

if [[ -z "$V_APP_ID" ]]; then
  fail "Application id missing from the submission response."
fi

echo "✓ Application submitted (PENDING, id $V_APP_ID)"

# An application already in progress must block a second one — the guard
# reads the User-side LatestApplication link written during submission.
V_DUP_HTTP="$(
  curl -sS -o "$LOG_DIR/v-dup.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/verification/applications" \
    -H "Authorization: Bearer $PROMOTED_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$V_SUBMIT_PAYLOAD")"

if [[ "$V_DUP_HTTP" != "409" ]]; then
  cat "$LOG_DIR/v-dup.json"
  fail "Second application while one is active should be 409, got HTTP $V_DUP_HTTP"
fi

python3 - "$LOG_DIR/v-dup.json" <<'PYJSON'
import json
import sys

body = json.load(open(sys.argv[1], encoding="utf-8"))

if body.get("code") != "APPLICATION_EXISTS":
    raise SystemExit("ERROR: expected APPLICATION_EXISTS, got {}".format(body.get("code")))

print("✓ Duplicate application refused (409 APPLICATION_EXISTS)")
PYJSON

echo
echo "[V7/8] Admin starts the review and approves..."

V_REVIEW_HTTP="$(
  curl -sS -o "$LOG_DIR/v-review.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/verification/applications/$V_APP_ID/actions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"action":"start_review"}')"

if [[ "$V_REVIEW_HTTP" != "200" && "$V_REVIEW_HTTP" != "201" ]]; then
  cat "$LOG_DIR/v-review.json"
  fail "start_review failed. HTTP $V_REVIEW_HTTP"
fi

V_REVIEW_STATUS="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("status",""))' "$LOG_DIR/v-review.json")"

if [[ "$V_REVIEW_STATUS" != "UNDER_REVIEW" ]]; then
  fail "Expected UNDER_REVIEW after start_review, got '$V_REVIEW_STATUS'"
fi

echo "✓ PENDING -> UNDER_REVIEW"

V_APPROVE_HTTP="$(
  curl -sS -o "$LOG_DIR/v-approve.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/verification/applications/$V_APP_ID/actions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"action":"approve","notes":"Runtime smoke approval"}')"

if [[ "$V_APPROVE_HTTP" != "200" && "$V_APPROVE_HTTP" != "201" ]]; then
  cat "$LOG_DIR/v-approve.json"
  fail "approve failed. HTTP $V_APPROVE_HTTP"
fi

V_APPROVE_STATUS="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("status",""))' "$LOG_DIR/v-approve.json")"

if [[ "$V_APPROVE_STATUS" != "VERIFIED" ]]; then
  fail "Expected VERIFIED after approve, got '$V_APPROVE_STATUS'"
fi

echo "✓ UNDER_REVIEW -> VERIFIED (summary + badge synced in the same transaction)"

echo
echo "[V8/8] Approval opens both marketplace gates..."

curl -sS "$API_URL$API_PREFIX/verification/me" \
  -H "Authorization: Bearer $PROMOTED_TOKEN" > "$LOG_DIR/v-me-promoted.json"

python3 - "$LOG_DIR/v-me-promoted.json" <<'PYJSON'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
business = data.get("business") or {}

if business.get("status") != "VERIFIED":
    raise SystemExit("ERROR: business status expected VERIFIED, got {}".format(business.get("status")))

if business.get("badge") is not True:
    raise SystemExit("ERROR: supplier badge expected true after approval")

if (business.get("latestApplication") or {}).get("status") != "VERIFIED":
    raise SystemExit("ERROR: latest application did not reach VERIFIED")

print("✓ Summary reports VERIFIED + badge, latest application VERIFIED")
PYJSON

V_PUBLISHED_HTTP="$(
  curl -sS -o "$LOG_DIR/v-published.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/products" \
    -H "Authorization: Bearer $PROMOTED_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"categoryId\":\"$SMOKE_CATEGORY_ID\",\"name\":\"CP17 Approved Listing\",\"slug\":\"cp17-approved-$V_TS\",\"sku\":\"BON-CP17-A-$V_TS\",\"price\":8,\"unit\":\"kg\",\"quantity\":5,\"status\":\"ACTIVE\"}")"

if [[ "$V_PUBLISHED_HTTP" != "200" && "$V_PUBLISHED_HTTP" != "201" ]]; then
  cat "$LOG_DIR/v-published.json"
  fail "ACTIVE create after approval failed. HTTP $V_PUBLISHED_HTTP"
fi

echo "✓ ACTIVE product create now succeeds"

V_ACCEPT_HTTP="$(
  curl -sS -o "$LOG_DIR/v-accept.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$V_ORDER_ID/status" \
    -H "Authorization: Bearer $PROMOTED_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"CONFIRMED"}')"

if [[ "$V_ACCEPT_HTTP" != "200" ]]; then
  cat "$LOG_DIR/v-accept.json"
  fail "Order accept after approval failed. HTTP $V_ACCEPT_HTTP"
fi

V_ACCEPTED_STATUS="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("status",""))' "$LOG_DIR/v-accept.json")"

if [[ "$V_ACCEPTED_STATUS" != "CONFIRMED" ]]; then
  fail "Expected CONFIRMED after accept, got '$V_ACCEPTED_STATUS'"
fi

echo "✓ Order accept now succeeds (PENDING -> CONFIRMED)"

echo
echo "✓ VERIFICATION GATE FLOW ACCEPTANCE PASSED"

else

echo "⚠ Business verification gate checks SKIPPED: no admin credentials (glue section skipped)."

fi

echo
echo "QUOTE TO ORDER CONVERSION FLOW (F1)"
echo "===================================="

# F1: an accepted, product-backed quote becomes ONE PENDING order priced
# at the agreed figure — never the catalog price. Positioned after CP17
# because converting is money-moving: the buyer's phone must already be
# verified by then (V2), exactly like cart checkout.

echo
echo "[Y1/7] Buyer posts a demand; the supplier quotes their own listing..."

Y_FUTURE_DATE="$(date -v+14d +%Y-%m-%d 2>/dev/null || date -d '+14 days' +%Y-%m-%d)"
Y_TITLE="Smoke Quote Checkout $(date +%s)"
Y_QUOTED_PRICE="9.75"

Y_CREATE_HTTP="$(
  curl -sS -o "$LOG_DIR/y-request.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"$Y_TITLE\",\"quantity\":40,\"unit\":\"kg\",\"destinationCity\":\"Tzaneen\",\"requiredBy\":\"$Y_FUTURE_DATE\"}")"

if [[ "$Y_CREATE_HTTP" != "201" ]]; then
  cat "$LOG_DIR/y-request.json"
  fail "F1 request creation failed. HTTP $Y_CREATE_HTTP"
fi

Y_REQUEST_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/y-request.json")"

if [[ -z "$Y_REQUEST_ID" ]]; then
  fail "F1 request creation returned no id."
fi

Y_RESPOND_HTTP="$(
  curl -sS -o "$LOG_DIR/y-respond.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests/$Y_REQUEST_ID/responses" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"We can cover this at a better price\",\"productId\":\"$PRODUCT_ID\",\"quotedPrice\":$Y_QUOTED_PRICE,\"quotedUnit\":\"per kg\"}")"

if [[ "$Y_RESPOND_HTTP" != "201" ]]; then
  cat "$LOG_DIR/y-respond.json"
  fail "F1 supplier quote failed. HTTP $Y_RESPOND_HTTP"
fi

Y_RESPONSE_ID="$(
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); assert d.get("productId"), "quote response is missing productId"; print(d.get("id",""))' "$LOG_DIR/y-respond.json")"

if [[ -z "$Y_RESPONSE_ID" ]]; then
  fail "F1 quote returned no id."
fi

echo "✓ Quote posted against the supplier's active listing (productId echoed)"

echo
echo "[Y2/7] Buyer accepts the quote..."

Y_ACCEPT_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/product-requests/responses/$Y_RESPONSE_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"ACCEPTED\"}")"

if [[ "$Y_ACCEPT_HTTP" != "200" ]]; then
  fail "F1 quote accept failed. HTTP $Y_ACCEPT_HTTP"
fi

echo "✓ Quote ACCEPTED"

echo
echo "[Y3/7] Converting creates ONE order at the agreed price..."

Y_CONVERT_HTTP="$(
  curl -sS -o "$LOG_DIR/y-convert.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests/responses/$Y_RESPONSE_ID/checkout" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"notes\":\"F1 quote checkout\"}")"

if [[ "$Y_CONVERT_HTTP" != "201" ]]; then
  cat "$LOG_DIR/y-convert.json"
  fail "F1 quote conversion failed. HTTP $Y_CONVERT_HTTP"
fi

python3 - "$LOG_DIR/y-convert.json" <<'PYJSON'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))

if data.get("orderCount") != 1:
    raise SystemExit("ERROR: expected exactly one order, got {}".format(data.get("orderCount")))

orders = data.get("orders") or []

if len(orders) != 1:
    raise SystemExit("ERROR: orders[] should hold one order, got {}".format(len(orders)))

order = orders[0]
items = order.get("items") or []

if len(items) != 1:
    raise SystemExit("ERROR: quote order should hold exactly one line item")

item = items[0]

# 9.75 agreed x 40 kg requested. The catalog lists this product at R18 —
# pricing must come from the quote, never the product row.
if float(item.get("unitPrice") or 0) != 9.75:
    raise SystemExit("ERROR: unitPrice should be the quoted 9.75, got {}".format(item.get("unitPrice")))

if int(item.get("quantity") or 0) != 40:
    raise SystemExit("ERROR: quantity should be the requested 40, got {}".format(item.get("quantity")))

if float(item.get("lineTotal") or 0) != 390.0:
    raise SystemExit("ERROR: lineTotal should be 390, got {}".format(item.get("lineTotal")))

if float(order.get("deliveryFee") or 0) != 0.0:
    raise SystemExit("ERROR: quote orders carry no delivery fee, got {}".format(order.get("deliveryFee")))

if float(order.get("total") or 0) != 390.0:
    raise SystemExit("ERROR: total should be 390, got {}".format(order.get("total")))

if order.get("status") != "PENDING":
    raise SystemExit("ERROR: new quote order should be PENDING, got {}".format(order.get("status")))

if not str(order.get("orderNumber") or "").startswith("BON-"):
    raise SystemExit("ERROR: orderNumber missing BON- prefix: {}".format(order.get("orderNumber")))

print("OK One PENDING order priced from the quote (9.75 x 40 = R390, fee 0)")
PYJSON

echo
echo "[Y4/7] The quote now reports its order; reconverting is refused..."

curl -sS "$API_URL$API_PREFIX/product-requests/$Y_REQUEST_ID/responses" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/y-responses-after.json"

Y_CLAIMED="$(
  python3 -c 'import json,sys; items=json.load(open(sys.argv[1],encoding="utf-8")); m={i.get("id"): i for i in items}; r=m.get(sys.argv[2], {}); print("yes" if r.get("orderId") and r.get("productId") else "no")' \
    "$LOG_DIR/y-responses-after.json" "$Y_RESPONSE_ID")"

if [[ "$Y_CLAIMED" != "yes" ]]; then
  fail "Converted quote should expose productId + orderId to the buyer."
fi

Y_RECONVERT_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests/responses/$Y_RESPONSE_ID/checkout" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\"}")"

if [[ "$Y_RECONVERT_HTTP" != "409" ]]; then
  fail "Reconverting a claimed quote returned HTTP $Y_RECONVERT_HTTP, expected 409"
fi

echo "✓ Quote carries productId + orderId; double conversion refused (409)"

echo
echo "[Y5/7] An unaccepted quote cannot convert..."

Y_OPEN_TITLE="Smoke Quote Unaccepted $(date +%s)"

Y_OPEN_CREATE_HTTP="$(
  curl -sS -o "$LOG_DIR/y-open-request.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"$Y_OPEN_TITLE\",\"quantity\":25,\"unit\":\"kg\",\"destinationCity\":\"Polokwane\"}")"

if [[ "$Y_OPEN_CREATE_HTTP" != "201" ]]; then
  fail "F1 unaccepted-quote request creation failed. HTTP $Y_OPEN_CREATE_HTTP"
fi

Y_OPEN_REQUEST_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/y-open-request.json")"

Y_OPEN_RESPOND_HTTP="$(
  curl -sS -o "$LOG_DIR/y-open-respond.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests/$Y_OPEN_REQUEST_ID/responses" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"Ready when you are\",\"productId\":\"$PRODUCT_ID\",\"quotedPrice\":8.5}")"

if [[ "$Y_OPEN_RESPOND_HTTP" != "201" ]]; then
  cat "$LOG_DIR/y-open-respond.json"
  fail "F1 unaccepted-quote respond failed. HTTP $Y_OPEN_RESPOND_HTTP"
fi

Y_OPEN_RESPONSE_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/y-open-respond.json")"

# No ACCEPT step — the quote stays OPEN and must never become an order.
Y_OPEN_CONVERT_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests/responses/$Y_OPEN_RESPONSE_ID/checkout" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\"}")"

if [[ "$Y_OPEN_CONVERT_HTTP" != "409" ]]; then
  fail "Converting an unaccepted quote returned HTTP $Y_OPEN_CONVERT_HTTP, expected 409"
fi

echo "✓ Unaccepted quote conversion refused (409)"

echo
echo "[Y6/7] Another buyer cannot convert someone else's quote..."

# Ownership is checked before any precondition, so a second BUYER needs
# nothing but an account: register -> verify email -> login -> convert.
rm -f "$CAPTURE_FILE"
Y_FOREIGN_EMAIL="f1_foreign_$(date +%s)@bonagri.local"

Y_FOREIGN_REGISTER_HTTP="$(
  curl -sS -o "$LOG_DIR/y-foreign-register.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$Y_FOREIGN_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"firstName\":\"Foreign\",\"lastName\":\"Buyer\"}")"

if [[ "$Y_FOREIGN_REGISTER_HTTP" != "200" && "$Y_FOREIGN_REGISTER_HTTP" != "201" ]]; then
  cat "$LOG_DIR/y-foreign-register.json"
  fail "F1 foreign-buyer registration failed. HTTP $Y_FOREIGN_REGISTER_HTTP"
fi

for _ in $(seq 1 30); do
  if [[ -s "$CAPTURE_FILE" ]]; then
    break
  fi
  sleep 0.5
done

if [[ ! -s "$CAPTURE_FILE" ]]; then
  fail "Verification URL was not captured for the foreign buyer."
fi

Y_FOREIGN_VERIFY_URL="$(cat "$CAPTURE_FILE")"
Y_FOREIGN_VERIFY_TOKEN="${Y_FOREIGN_VERIFY_URL##*token=}"

if [[ -z "$Y_FOREIGN_VERIFY_TOKEN" ]]; then
  fail "Foreign buyer verification token could not be extracted."
fi

Y_FOREIGN_VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/y-foreign-verify.json" -w "%{http_code}" \
    --get \
    --data-urlencode "token=$Y_FOREIGN_VERIFY_TOKEN" \
    "$API_URL$API_PREFIX/auth/verify-email"
)"

if [[ "$Y_FOREIGN_VERIFY_HTTP" != "200" ]]; then
  cat "$LOG_DIR/y-foreign-verify.json"
  fail "F1 foreign-buyer email verification failed. HTTP $Y_FOREIGN_VERIFY_HTTP"
fi

Y_FOREIGN_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/y-foreign-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$Y_FOREIGN_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")"

if [[ "$Y_FOREIGN_LOGIN_HTTP" != "200" && "$Y_FOREIGN_LOGIN_HTTP" != "201" ]]; then
  cat "$LOG_DIR/y-foreign-login.json"
  fail "F1 foreign-buyer login failed. HTTP $Y_FOREIGN_LOGIN_HTTP"
fi

Y_FOREIGN_TOKEN="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("accessToken",""))' "$LOG_DIR/y-foreign-login.json")"

if [[ -z "$Y_FOREIGN_TOKEN" ]]; then
  fail "Foreign buyer access token missing."
fi

Y_FOREIGN_CONVERT_HTTP="$(
  curl -sS -o "$LOG_DIR/y-foreign-convert.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests/responses/$Y_RESPONSE_ID/checkout" \
    -H "Authorization: Bearer $Y_FOREIGN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\"}")"

if [[ "$Y_FOREIGN_CONVERT_HTTP" != "404" ]]; then
  cat "$LOG_DIR/y-foreign-convert.json"
  fail "Foreign quote conversion returned HTTP $Y_FOREIGN_CONVERT_HTTP, expected 404"
fi

python3 - "$LOG_DIR/y-foreign-convert.json" <<'PYJSON'
import json
import sys

body = json.load(open(sys.argv[1], encoding="utf-8"))

# Ownership fires before phone/address gates: the stranger must see the
# flat "quote not found", never a precondition hinting the quote exists.
if body.get("statusCode") != 404 or body.get("message") != "Quote not found":
    raise SystemExit("ERROR: expected 404 'Quote not found', got {}".format(body))

print("OK Foreign buyer refused with the flat 404 (no existence leak)")
PYJSON

echo
echo "[Y7/7] Route guard: only an authenticated BUYER may convert..."

Y_SUPPLIER_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests/responses/$Y_RESPONSE_ID/checkout" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\"}")"

if [[ "$Y_SUPPLIER_HTTP" != "403" ]]; then
  fail "Supplier converting a quote returned HTTP $Y_SUPPLIER_HTTP, expected 403"
fi

Y_ANON_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/product-requests/responses/$Y_RESPONSE_ID/checkout" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\"}")"

if [[ "$Y_ANON_HTTP" != "401" ]]; then
  fail "Anonymous conversion returned HTTP $Y_ANON_HTTP, expected 401"
fi

echo "✓ Supplier 403, anonymous 401"

echo
echo "✓ QUOTE TO ORDER CONVERSION ACCEPTANCE PASSED"

echo
echo "CART & MULTI-ITEM CHECKOUT FLOW"
echo "========================================"

echo
echo "[I1/4] Buyer cart splits checkout into one order per supplier..."

# Start clean in case a previous run crashed mid-checkout.
curl -sS -o /dev/null -X DELETE "$API_URL$API_PREFIX/cart" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

I_TS="$(date +%s)"
I_SLUG_A="cp10-cart-a-$I_TS"
I_SKU_A="BON-CP10-A-$I_TS"
I_SLUG_B="cp10-cart-b-$I_TS"
I_SKU_B="BON-CP10-B-$I_TS"

I_CREATE_A_HTTP="$(
  curl -sS -o "$LOG_DIR/i-product-a.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/products" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"categoryId\":\"$SMOKE_CATEGORY_ID\",\"name\":\"CP10 Cart Tomatoes\",\"slug\":\"$I_SLUG_A\",\"sku\":\"$I_SKU_A\",\"price\":12,\"unit\":\"kg\",\"quantity\":10,\"status\":\"ACTIVE\"}")"

if [[ "$I_CREATE_A_HTTP" != "200" && "$I_CREATE_A_HTTP" != "201" ]]; then
  fail "Cart product A creation failed. HTTP $I_CREATE_A_HTTP"
fi

I_CREATE_B_HTTP="$(
  curl -sS -o "$LOG_DIR/i-product-b.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/products" \
    -H "Authorization: Bearer $DEALER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"categoryId\":\"$DEALER_TOOLS_CATEGORY_ID\",\"name\":\"CP10 Cart Wheelbarrow\",\"slug\":\"$I_SLUG_B\",\"sku\":\"$I_SKU_B\",\"price\":30,\"unit\":\"each\",\"quantity\":10,\"status\":\"ACTIVE\"}")"

if [[ "$I_CREATE_B_HTTP" != "200" && "$I_CREATE_B_HTTP" != "201" ]]; then
  fail "Cart product B creation failed. HTTP $I_CREATE_B_HTTP"
fi

I_PRODUCT_A="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/i-product-a.json")"

I_PRODUCT_B="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/i-product-b.json")"

I_ADD_A_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/cart/items" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"productId\":\"$I_PRODUCT_A\",\"quantity\":2}")"

if [[ "$I_ADD_A_HTTP" != "201" ]]; then
  fail "Adding product A to cart failed. HTTP $I_ADD_A_HTTP"
fi

I_ADD_B_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/cart/items" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"productId\":\"$I_PRODUCT_B\",\"quantity\":3}")"

if [[ "$I_ADD_B_HTTP" != "201" ]]; then
  fail "Adding product B to cart failed. HTTP $I_ADD_B_HTTP"
fi

curl -sS "$API_URL$API_PREFIX/cart" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/i-cart.json"

python3 - "$LOG_DIR/i-cart.json" "$I_PRODUCT_A" "$I_PRODUCT_B" <<'PYJSON'
import json
import sys

items = json.load(open(sys.argv[1], encoding="utf-8"))

if len(items) != 2:
    raise SystemExit("ERROR: cart should hold 2 items, got {}".format(len(items)))

by_product = {i["product"]["id"]: i for i in items}

if by_product.get(sys.argv[2], {}).get("quantity") != 2:
    raise SystemExit("ERROR: product A cart quantity wrong")

if by_product.get(sys.argv[3], {}).get("quantity") != 3:
    raise SystemExit("ERROR: product B cart quantity wrong")

print("OK Cart holds both suppliers items with correct quantities")
PYJSON

I_CHECKOUT_HTTP="$(
  curl -sS -o "$LOG_DIR/i-checkout.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/cart/checkout" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"notes\":\"CP10 checkout\"}")"

if [[ "$I_CHECKOUT_HTTP" != "200" && "$I_CHECKOUT_HTTP" != "201" ]]; then
  fail "Checkout failed. HTTP $I_CHECKOUT_HTTP"
  cat "$LOG_DIR/i-checkout.json"
fi

python3 - "$LOG_DIR/i-checkout.json" <<'PYJSON'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))

if data.get("orderCount") != 2:
    raise SystemExit("ERROR: expected 2 orders, got {}".format(data.get("orderCount")))

if not data.get("orderGroupId"):
    raise SystemExit("ERROR: missing orderGroupId on checkout")

totals = sorted(float(o["total"]) for o in data.get("orders", []))

if totals != [24.0, 90.0]:
    raise SystemExit("ERROR: order totals wrong: {}".format(totals))

print("OK Checkout split into 2 orders under one orderGroupId (R24 + R90)")
PYJSON

I_CART_AFTER="$(curl -sS "$API_URL$API_PREFIX/cart" \
  -H "Authorization: Bearer $ACCESS_TOKEN")"

if [[ "$I_CART_AFTER" != "[]" ]]; then
  fail "Cart was not cleared after checkout: $I_CART_AFTER"
fi

curl -sS "$API_URL$API_PREFIX/products/$I_PRODUCT_A" \
  -o "$LOG_DIR/i-product-a-after.json"
curl -sS "$API_URL$API_PREFIX/products/$I_PRODUCT_B" \
  -o "$LOG_DIR/i-product-b-after.json"

python3 - "$LOG_DIR/i-product-a-after.json" "$LOG_DIR/i-product-b-after.json" <<'PYJSON'
import json
import sys

a = json.load(open(sys.argv[1], encoding="utf-8"))
b = json.load(open(sys.argv[2], encoding="utf-8"))

reserved_a = (a.get("inventory") or {}).get("reservedQuantity")
reserved_b = (b.get("inventory") or {}).get("reservedQuantity")

if reserved_a != 2:
    raise SystemExit("ERROR: product A reservedQuantity expected 2, got {}".format(reserved_a))

if reserved_b != 3:
    raise SystemExit("ERROR: product B reservedQuantity expected 3, got {}".format(reserved_b))

print("OK Inventory reserved per cart quantity (2 kg, 3 units)")
PYJSON

curl -sS "$API_URL$API_PREFIX/orders" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/i-orders.json"

python3 - "$LOG_DIR/i-orders.json" "$LOG_DIR/i-checkout.json" <<'PYJSON'
import json
import sys

orders = json.load(open(sys.argv[1], encoding="utf-8"))
placed = json.load(open(sys.argv[2], encoding="utf-8"))
group = placed.get("orderGroupId")
placed_numbers = {o.get("orderNumber") for o in placed.get("orders", [])}
matches = [o for o in orders if o.get("orderNumber") in placed_numbers]

if len(matches) != 2:
    raise SystemExit("ERROR: expected both new orders in the buyer list, got {}".format(len(matches)))

if any(o.get("orderGroupId") != group for o in matches):
    raise SystemExit("ERROR: buyer list orders do not share the orderGroupId")

print("OK Buyer orders list shows both orders under the shared group")
PYJSON

echo
echo "[I2/4] Single-supplier checkout stays one order; caps and empty cart hold..."

I_ADD_SOLE_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/cart/items" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"productId\":\"$I_PRODUCT_B\",\"quantity\":1}")"

if [[ "$I_ADD_SOLE_HTTP" != "201" ]]; then
  fail "Adding sole supplier item failed. HTTP $I_ADD_SOLE_HTTP"
fi

I_SOLE_CHECKOUT_HTTP="$(
  curl -sS -o "$LOG_DIR/i-checkout-sole.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/cart/checkout" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\"}")"

if [[ "$I_SOLE_CHECKOUT_HTTP" != "200" && "$I_SOLE_CHECKOUT_HTTP" != "201" ]]; then
  fail "Sole supplier checkout failed. HTTP $I_SOLE_CHECKOUT_HTTP"
fi

I_SOLE_COUNT="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("orderCount",""))' "$LOG_DIR/i-checkout-sole.json")"

if [[ "$I_SOLE_COUNT" != "1" ]]; then
  fail "Single-supplier cart produced $I_SOLE_COUNT orders, expected 1"
fi

I_OVER_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/cart/items" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"productId\":\"$I_PRODUCT_B\",\"quantity\":9999}")"

if [[ "$I_OVER_HTTP" != "400" ]]; then
  fail "Over-stock add returned HTTP $I_OVER_HTTP, expected 400"
fi

I_DEACTIVATE_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/products/$I_PRODUCT_A" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"INACTIVE"}')"

if [[ "$I_DEACTIVATE_HTTP" != "200" ]]; then
  fail "Deactivating product A failed. HTTP $I_DEACTIVATE_HTTP"
fi

I_DELISTED_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/cart/items" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"productId\":\"$I_PRODUCT_A\",\"quantity\":1}")"

if [[ "$I_DELISTED_HTTP" != "400" ]]; then
  fail "Delisted product add returned HTTP $I_DELISTED_HTTP, expected 400"
fi

I_EMPTY_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/cart/checkout" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\"}")"

if [[ "$I_EMPTY_HTTP" != "400" ]]; then
  fail "Empty cart checkout returned HTTP $I_EMPTY_HTTP, expected 400"
fi

echo "OK Single supplier stays 1 order; over-stock 400; delisted add 400; empty checkout 400"

echo
echo "[I3/4] Cart role and ownership guards hold..."

I_ANON_GET_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" "$API_URL$API_PREFIX/cart")"

if [[ "$I_ANON_GET_HTTP" != "401" ]]; then
  fail "Anonymous cart read returned HTTP $I_ANON_GET_HTTP, expected 401"
fi

I_ANON_POST_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/cart/items" \
    -H "Content-Type: application/json" \
    -d "{\"productId\":\"$I_PRODUCT_B\",\"quantity\":1}")"

if [[ "$I_ANON_POST_HTTP" != "401" ]]; then
  fail "Anonymous cart add returned HTTP $I_ANON_POST_HTTP, expected 401"
fi

I_VENDOR_POST_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/cart/items" \
    -H "Authorization: Bearer $DEALER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"productId\":\"$I_PRODUCT_B\",\"quantity\":1}")"

if [[ "$I_VENDOR_POST_HTTP" != "403" ]]; then
  fail "Vendor cart add returned HTTP $I_VENDOR_POST_HTTP, expected 403"
fi

I_FOREIGN_PATCH_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/cart/items/00000000-0000-4000-8000-000000000000" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"quantity\":2}")"

if [[ "$I_FOREIGN_PATCH_HTTP" != "404" ]]; then
  fail "Unknown cart item patch returned HTTP $I_FOREIGN_PATCH_HTTP, expected 404"
fi

echo "OK Anon read/add 401, vendor add 403, unknown item patch 404"

echo
echo "[I4/4] Checkout flow pages serve..."

I_WEB_CODE="$(
  curl -sS -m 90 -o /dev/null -w "%{http_code}" "$WEB_URL/checkout")"

if [[ "$I_WEB_CODE" != "200" ]]; then
  fail "Web route /checkout returned HTTP $I_WEB_CODE"
fi

# C1: the cart → delivery → checkout split adds the delivery step as its
# own route — it must render like the other two.
I_DELIVERY_CODE="$(
  curl -sS -m 90 -o /dev/null -w "%{http_code}" "$WEB_URL/checkout/delivery")"

if [[ "$I_DELIVERY_CODE" != "200" ]]; then
  fail "Web route /checkout/delivery returned HTTP $I_DELIVERY_CODE"
fi

echo "✓ Web routes /checkout and /checkout/delivery -> 200"

echo
echo "✓ CART & MULTI-ITEM CHECKOUT FLOW ACCEPTANCE PASSED"

echo
echo "MANUAL EFT PAYMENT + INVOICE FLOW"
echo "========================================"

echo
echo "[J1/3] Buyer records EFT evidence against a pending order..."

J_TS="$(date +%s)"
J_SLUG="cp11-eft-$J_TS"
J_SKU="BON-CP11-$J_TS"

J_CREATE_HTTP="$(
  curl -sS -o "$LOG_DIR/j-product.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/products" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"categoryId\":\"$SMOKE_CATEGORY_ID\",\"name\":\"CP11 EFT Tomatoes\",\"slug\":\"$J_SLUG\",\"sku\":\"$J_SKU\",\"price\":20,\"unit\":\"kg\",\"quantity\":6,\"status\":\"ACTIVE\"}")"

if [[ "$J_CREATE_HTTP" != "200" && "$J_CREATE_HTTP" != "201" ]]; then
  fail "CP11 product creation failed. HTTP $J_CREATE_HTTP"
fi

J_PRODUCT="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/j-product.json")"

J_ORDER_HTTP="$(
  curl -sS -o "$LOG_DIR/j-order.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"productId\":\"$J_PRODUCT\",\"quantity\":2,\"notes\":\"CP11 EFT order\"}")"

if [[ "$J_ORDER_HTTP" != "200" && "$J_ORDER_HTTP" != "201" ]]; then
  fail "CP11 order creation failed. HTTP $J_ORDER_HTTP"
  cat "$LOG_DIR/j-order.json"
fi

J_ORDER="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/j-order.json")"

J_ORDER_NUMBER="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("orderNumber",""))' "$LOG_DIR/j-order.json")"

J_PAY_HTTP="$(
  curl -sS -o "$LOG_DIR/j-payment.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$J_ORDER/payment" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"transactionRef\":\"EFT-J-$J_TS\"}")"

if [[ "$J_PAY_HTTP" != "200" && "$J_PAY_HTTP" != "201" ]]; then
  fail "Recording EFT payment failed. HTTP $J_PAY_HTTP"
  cat "$LOG_DIR/j-payment.json"
fi

python3 - "$LOG_DIR/j-payment.json" <<'PYJSON'
import json
import sys

payment = json.load(open(sys.argv[1], encoding="utf-8"))

if payment.get("status") != "PENDING":
    raise SystemExit("ERROR: payment should start PENDING, got {}".format(payment.get("status")))

if payment.get("provider") != "MANUAL":
    raise SystemExit("ERROR: provider should be MANUAL, got {}".format(payment.get("provider")))

if float(payment.get("amount") or 0) != 40.0:
    raise SystemExit("ERROR: payment amount should be 40.0 (2 x R20), got {}".format(payment.get("amount")))

print("OK Payment recorded: MANUAL, PENDING, amount R40")
PYJSON

J_DUP_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$J_ORDER/payment" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"transactionRef\":\"EFT-J-$J_TS-B\"}")"

if [[ "$J_DUP_HTTP" != "409" ]]; then
  fail "Duplicate EFT record returned HTTP $J_DUP_HTTP, expected 409"
fi

curl -sS "$API_URL$API_PREFIX/orders/$J_ORDER" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/j-order-after-pay.json"

python3 - "$LOG_DIR/j-order-after-pay.json" <<'PYJSON'
import json
import sys

order = json.load(open(sys.argv[1], encoding="utf-8"))

if order.get("status") != "PENDING":
    raise SystemExit("ERROR: recording payment must not move the order (got {})".format(order.get("status")))

payment = order.get("payment") or {}

if payment.get("status") != "PENDING":
    raise SystemExit("ERROR: order payload is missing the pending payment")

if not str(payment.get("transactionRef") or "").startswith("EFT-J-"):
    raise SystemExit("ERROR: payment transactionRef not carried on the order")

if order.get("invoice") is not None:
    raise SystemExit("ERROR: invoice must not exist before CONFIRMED")

print("OK Order stays PENDING with payment attached; no invoice yet")
PYJSON

echo "OK Duplicate record 409; payment is evidence only"

echo
echo "[J2/3] Supplier verifies, buyer notified, confirm issues the invoice..."

J_VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/j-verify.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$J_ORDER/payment" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"PAID"}')"

if [[ "$J_VERIFY_HTTP" != "200" ]]; then
  fail "Payment verification failed. HTTP $J_VERIFY_HTTP"
  cat "$LOG_DIR/j-verify.json"
fi

python3 - "$LOG_DIR/j-verify.json" <<'PYJSON'
import json
import sys

payment = json.load(open(sys.argv[1], encoding="utf-8"))

if payment.get("status") != "PAID":
    raise SystemExit("ERROR: payment should be PAID, got {}".format(payment.get("status")))

if not payment.get("paidAt"):
    raise SystemExit("ERROR: paidAt must be stamped on verification")

print("OK Payment verified: PAID with paidAt stamped")
PYJSON

curl -sS "$API_URL$API_PREFIX/notifications" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/j-notifications.json"

python3 - "$LOG_DIR/j-notifications.json" "$J_ORDER_NUMBER" <<'PYJSON'
import json
import sys

rows = json.load(open(sys.argv[1], encoding="utf-8"))
title = "Payment received for order {}".format(sys.argv[2])

if not any(n.get("title") == title for n in rows):
    raise SystemExit("ERROR: buyer has no payment notification for {}".format(sys.argv[2]))

print("OK Buyer received the payment-received notification")
PYJSON

J_CONFIRM_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$J_ORDER/status" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"CONFIRMED"}')"

if [[ "$J_CONFIRM_HTTP" != "200" ]]; then
  fail "Confirming the CP11 order failed. HTTP $J_CONFIRM_HTTP"
fi

curl -sS "$API_URL$API_PREFIX/orders/$J_ORDER" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/j-order-confirmed.json"

python3 - "$LOG_DIR/j-order-confirmed.json" "$J_ORDER_NUMBER" <<'PYJSON'
import json
import sys

order = json.load(open(sys.argv[1], encoding="utf-8"))
order_number = sys.argv[2]

if order.get("status") != "CONFIRMED":
    raise SystemExit("ERROR: order should be CONFIRMED, got {}".format(order.get("status")))

invoice = order.get("invoice") or {}
expected_number = "INV-{}".format(order_number)

if invoice.get("invoiceNumber") != expected_number:
    raise SystemExit("ERROR: invoiceNumber should be {}, got {}".format(expected_number, invoice.get("invoiceNumber")))

for key, expected in (("subtotal", 40.0), ("deliveryFee", 0.0), ("total", 40.0)):
    if float(invoice.get(key) or 0) != expected:
        raise SystemExit("ERROR: invoice {} should be {}, got {}".format(key, expected, invoice.get(key)))

payment = order.get("payment") or {}

if payment.get("status") != "PAID":
    raise SystemExit("ERROR: payment should stay PAID through confirmation")

print("OK Invoice {} issued with matching totals; payment stays PAID".format(expected_number))
PYJSON

J_REVERIFY_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$J_ORDER/payment" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"PAID"}')"

if [[ "$J_REVERIFY_HTTP" != "409" ]]; then
  fail "Re-verifying a PAID payment returned HTTP $J_REVERIFY_HTTP, expected 409"
fi

J_REPAY_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$J_ORDER/payment" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"transactionRef\":\"EFT-J-$J_TS-C\"}")"

if [[ "$J_REPAY_HTTP" != "409" ]]; then
  fail "Re-recording after verification returned HTTP $J_REPAY_HTTP, expected 409"
fi

echo "OK Confirm issued the invoice; repeat verify/record rejected with 409"

echo
echo "[J3/3] Payment guard matrix and the printable invoice route..."

J_ANON_POST_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$J_ORDER/payment" \
    -H "Content-Type: application/json" \
    -d '{"transactionRef":"EFT-ANON"}')"

if [[ "$J_ANON_POST_HTTP" != "401" ]]; then
  fail "Anonymous payment record returned HTTP $J_ANON_POST_HTTP, expected 401"
fi

J_ANON_PATCH_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$J_ORDER/payment" \
    -H "Content-Type: application/json" \
    -d '{"status":"PAID"}')"

if [[ "$J_ANON_PATCH_HTTP" != "401" ]]; then
  fail "Anonymous payment verify returned HTTP $J_ANON_PATCH_HTTP, expected 401"
fi

J_DEALER_POST_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$J_ORDER/payment" \
    -H "Authorization: Bearer $DEALER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"transactionRef\":\"EFT-J-$J_TS-D\"}")"

if [[ "$J_DEALER_POST_HTTP" != "403" ]]; then
  fail "Vendor payment record returned HTTP $J_DEALER_POST_HTTP, expected 403"
fi

J_BUYER_PATCH_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$J_ORDER/payment" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"PAID"}')"

if [[ "$J_BUYER_PATCH_HTTP" != "403" ]]; then
  fail "Buyer payment verify returned HTTP $J_BUYER_PATCH_HTTP, expected 403"
fi

J_FOREIGN_PATCH_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$J_ORDER/payment" \
    -H "Authorization: Bearer $DEALER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"PAID"}')"

if [[ "$J_FOREIGN_PATCH_HTTP" != "404" ]]; then
  fail "Foreign supplier payment verify returned HTTP $J_FOREIGN_PATCH_HTTP, expected 404"
fi

J_ORDER2_HTTP="$(
  curl -sS -o "$LOG_DIR/j-order2.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"productId\":\"$J_PRODUCT\",\"quantity\":1}")"

if [[ "$J_ORDER2_HTTP" != "200" && "$J_ORDER2_HTTP" != "201" ]]; then
  fail "CP11 second order creation failed. HTTP $J_ORDER2_HTTP"
fi

J_ORDER2="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/j-order2.json")"

J_NOPAY_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$J_ORDER2/payment" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"PAID"}')"

if [[ "$J_NOPAY_HTTP" != "409" ]]; then
  fail "Verifying an order without payment returned HTTP $J_NOPAY_HTTP, expected 409"
fi

J_WRONG_STATE_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$J_ORDER/payment" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"transactionRef\":\"EFT-J-$J_TS-E\"}")"

if [[ "$J_WRONG_STATE_HTTP" != "409" ]]; then
  fail "Recording on a CONFIRMED order returned HTTP $J_WRONG_STATE_HTTP, expected 409"
fi

echo "OK Anon 401/401, vendor 403, buyer 403, foreign 404, no-payment 409, wrong-state 409"

echo
echo "Printable invoice route..."

J_WEB_CODE="$(
  curl -sS -m 90 -o /dev/null -w "%{http_code}" "$WEB_URL/orders/$J_ORDER/invoice")"

if [[ "$J_WEB_CODE" != "200" ]]; then
  fail "Web route /orders/$J_ORDER/invoice returned HTTP $J_WEB_CODE"
fi

echo "✓ Web route /orders/<id>/invoice -> 200"

echo
echo "✓ MANUAL EFT PAYMENT + INVOICE FLOW ACCEPTANCE PASSED"

echo
echo "DELIVERY TRACKING FLOW"
echo "========================================"

echo
echo "[K1/2] Full lifecycle with driver details; delivery row stays in sync..."

K_TS="$(date +%s)"
K_SLUG="cp12-delivery-$K_TS"
K_SKU="BON-CP12-$K_TS"
K_DATE="$(python3 -c 'import datetime; print((datetime.date.today() + datetime.timedelta(days=2)).isoformat())')"

K_CREATE_HTTP="$(
  curl -sS -o "$LOG_DIR/k-product.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/products" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"categoryId\":\"$SMOKE_CATEGORY_ID\",\"name\":\"CP12 Delivery Cabbage\",\"slug\":\"$K_SLUG\",\"sku\":\"$K_SKU\",\"price\":25,\"unit\":\"head\",\"quantity\":5,\"status\":\"ACTIVE\"}")"

if [[ "$K_CREATE_HTTP" != "200" && "$K_CREATE_HTTP" != "201" ]]; then
  fail "CP12 product creation failed. HTTP $K_CREATE_HTTP"
fi

K_PRODUCT="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/k-product.json")"

K_ORDER_HTTP="$(
  curl -sS -o "$LOG_DIR/k-order.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"productId\":\"$K_PRODUCT\",\"quantity\":2,\"notes\":\"CP12 live\"}")"

if [[ "$K_ORDER_HTTP" != "200" && "$K_ORDER_HTTP" != "201" ]]; then
  fail "CP12 order creation failed. HTTP $K_ORDER_HTTP"
  cat "$LOG_DIR/k-order.json"
fi

K_ORDER="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/k-order.json")"
K_ORDER_NUMBER="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("orderNumber",""))' "$LOG_DIR/k-order.json")"

for K_STEP in CONFIRMED PROCESSING READY_FOR_DELIVERY; do
  K_ADV_HTTP="$(
    curl -sS -o /dev/null -w "%{http_code}" \
      -X PATCH "$API_URL$API_PREFIX/orders/$K_ORDER/status" \
      -H "Authorization: Bearer $SUPPLIER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"$K_STEP\"}")"

  if [[ "$K_ADV_HTTP" != "200" ]]; then
    fail "Advancing order to $K_STEP failed. HTTP $K_ADV_HTTP"
  fi
done

K_OFD_HTTP="$(
  curl -sS -o "$LOG_DIR/k-ofd.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$K_ORDER/status" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"OUT_FOR_DELIVERY\",\"driverName\":\"Kabelo Nkuna\",\"driverPhone\":\"082 555 1234\",\"estimatedDate\":\"$K_DATE\",\"trackingNumber\":\"TRK-K-$K_TS\"}")"

if [[ "$K_OFD_HTTP" != "200" ]]; then
  fail "Marking out for delivery failed. HTTP $K_OFD_HTTP"
  cat "$LOG_DIR/k-ofd.json"
fi

curl -sS "$API_URL$API_PREFIX/orders/$K_ORDER" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/k-order-ofd.json"

python3 - "$LOG_DIR/k-order-ofd.json" "$K_DATE" <<'PYJSON'
import json
import sys

order = json.load(open(sys.argv[1], encoding="utf-8"))
expected_date = sys.argv[2]
delivery = order.get("delivery") or {}

if order.get("status") != "OUT_FOR_DELIVERY":
    raise SystemExit("ERROR: order should be OUT_FOR_DELIVERY, got {}".format(order.get("status")))

if delivery.get("status") != "ASSIGNED":
    raise SystemExit("ERROR: delivery should be ASSIGNED, got {}".format(delivery.get("status")))

if delivery.get("driverName") != "Kabelo Nkuna" or delivery.get("driverPhone") != "082 555 1234":
    raise SystemExit("ERROR: driver details not stored: {!r}".format(delivery))

if not str(delivery.get("trackingNumber") or "").startswith("TRK-K-"):
    raise SystemExit("ERROR: tracking number not stored: {!r}".format(delivery.get("trackingNumber")))

if not str(delivery.get("estimatedDate") or "").startswith(expected_date):
    raise SystemExit("ERROR: estimatedDate should start with {}, got {!r}".format(expected_date, delivery.get("estimatedDate")))

if not delivery.get("pickedUpAt"):
    raise SystemExit("ERROR: pickedUpAt must be stamped at OUT_FOR_DELIVERY")

if delivery.get("deliveredAt"):
    raise SystemExit("ERROR: deliveredAt must not exist yet")

print("OK Delivery ASSIGNED with driver, tracking, expected date, pickedUpAt")
PYJSON

K_VIEW_HTTP="$(
  curl -sS -o "$LOG_DIR/k-view.json" -w "%{http_code}" \
    "$API_URL$API_PREFIX/orders/$K_ORDER/delivery" \
    -H "Authorization: Bearer $ACCESS_TOKEN")"

if [[ "$K_VIEW_HTTP" != "200" ]]; then
  fail "GET delivery view failed. HTTP $K_VIEW_HTTP"
fi

python3 - "$LOG_DIR/k-view.json" <<'PYJSON'
import json
import sys

view = json.load(open(sys.argv[1], encoding="utf-8"))

if view.get("status") != "ASSIGNED" or view.get("driverName") != "Kabelo Nkuna":
    raise SystemExit("ERROR: delivery view mismatch: {!r}".format(view))

print("OK GET /orders/:id/delivery returns the tracking view")
PYJSON

K_DELIVERED_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$K_ORDER/status" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"DELIVERED"}')"

if [[ "$K_DELIVERED_HTTP" != "200" ]]; then
  fail "Marking delivered failed. HTTP $K_DELIVERED_HTTP"
fi

curl -sS "$API_URL$API_PREFIX/orders/$K_ORDER" \
  -H "Authorization: Bearer $ACCESS_TOKEN" > "$LOG_DIR/k-order-delivered.json"

python3 - "$LOG_DIR/k-order-delivered.json" <<'PYJSON'
import json
import sys

order = json.load(open(sys.argv[1], encoding="utf-8"))
delivery = order.get("delivery") or {}

if order.get("status") != "DELIVERED":
    raise SystemExit("ERROR: order should be DELIVERED, got {}".format(order.get("status")))

if delivery.get("status") != "DELIVERED":
    raise SystemExit("ERROR: delivery should be DELIVERED, got {}".format(delivery.get("status")))

if not delivery.get("deliveredAt"):
    raise SystemExit("ERROR: deliveredAt must be stamped at DELIVERED")

if delivery.get("driverName") != "Kabelo Nkuna" or not str(delivery.get("trackingNumber") or "").startswith("TRK-K-"):
    raise SystemExit("ERROR: driver fields should survive the DELIVERED sync: {!r}".format(delivery))

print("OK Delivery synced to DELIVERED with deliveredAt; driver fields retained")
PYJSON

echo "OK Lifecycle walked with driver details; row synced at every step"

echo
echo "[K2/2] Delivery guards hold..."

K_ORDER2_HTTP="$(
  curl -sS -o "$LOG_DIR/k-order2.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"productId\":\"$K_PRODUCT\",\"quantity\":1}")"

if [[ "$K_ORDER2_HTTP" != "200" && "$K_ORDER2_HTTP" != "201" ]]; then
  fail "CP12 second order creation failed. HTTP $K_ORDER2_HTTP"
fi

K_ORDER2="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/k-order2.json")"

K_NO_ROW_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    "$API_URL$API_PREFIX/orders/$K_ORDER2/delivery" \
    -H "Authorization: Bearer $ACCESS_TOKEN")"

if [[ "$K_NO_ROW_HTTP" != "404" ]]; then
  fail "Delivery view on an unshipped order returned HTTP $K_NO_ROW_HTTP, expected 404"
fi

K_WRONG_STATE_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$K_ORDER2/status" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"CONFIRMED","driverName":"Too Early"}')"

if [[ "$K_WRONG_STATE_HTTP" != "400" ]]; then
  fail "Delivery details on CONFIRMED returned HTTP $K_WRONG_STATE_HTTP, expected 400"
fi

for K_STEP in CONFIRMED PROCESSING READY_FOR_DELIVERY; do
  K_ADV2_HTTP="$(
    curl -sS -o /dev/null -w "%{http_code}" \
      -X PATCH "$API_URL$API_PREFIX/orders/$K_ORDER2/status" \
      -H "Authorization: Bearer $SUPPLIER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"$K_STEP\"}")"

  if [[ "$K_ADV2_HTTP" != "200" ]]; then
    fail "Advancing order2 to $K_STEP failed. HTTP $K_ADV2_HTTP"
  fi
done

K_DUP_TRACK_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$K_ORDER2/status" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"OUT_FOR_DELIVERY\",\"driverName\":\"Kabelo Nkuna\",\"driverPhone\":\"082 555 1234\",\"trackingNumber\":\"TRK-K-$K_TS\"}")"

if [[ "$K_DUP_TRACK_HTTP" != "409" ]]; then
  fail "Duplicate tracking number returned HTTP $K_DUP_TRACK_HTTP, expected 409"
fi

K_FOREIGN_VIEW_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    "$API_URL$API_PREFIX/orders/$K_ORDER/delivery" \
    -H "Authorization: Bearer $DEALER_TOKEN")"

if [[ "$K_FOREIGN_VIEW_HTTP" != "404" ]]; then
  fail "Foreign delivery view returned HTTP $K_FOREIGN_VIEW_HTTP, expected 404"
fi

K_ANON_VIEW_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    "$API_URL$API_PREFIX/orders/$K_ORDER/delivery")"

if [[ "$K_ANON_VIEW_HTTP" != "401" ]]; then
  fail "Anonymous delivery view returned HTTP $K_ANON_VIEW_HTTP, expected 401"
fi

echo "OK No-row 404, early-details 400, duplicate tracking 409, foreign 404, anon 401"

echo
echo "Order detail page serves the tracking..."

K_WEB_CODE="$(
  curl -sS -m 90 -o /dev/null -w "%{http_code}" "$WEB_URL/orders/$K_ORDER")"

if [[ "$K_WEB_CODE" != "200" ]]; then
  fail "Web route /orders/$K_ORDER returned HTTP $K_WEB_CODE"
fi

echo "✓ Web route /orders/<id> -> 200"

echo
echo "✓ DELIVERY TRACKING FLOW ACCEPTANCE PASSED"

echo
echo "========================================"
echo "TRANSPORTER DELIVERY FLOW (CP14)"
echo "========================================"

# CP14: section M runs BEFORE the admin section on purpose — the admin
# section's A2 journey re-roles the main smoke buyer to SUPPLIER, and M
# needs a BUYER to place its orders. It also runs before section L (L's
# login burst exhausts the per-IP login bucket). The letters are labels,
# not execution order.

echo
echo "[M1/10] Registering a fresh transporter account..."

rm -f "$CAPTURE_FILE"
M_EMAIL="cp14_transport_$(date +%s)@bonagri.local"

M_REGISTER_HTTP="$(
  curl -sS -o "$LOG_DIR/m-register.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$M_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"firstName\":\"Mosa\",\"lastName\":\"Haulier\"}"
)"

if [[ "$M_REGISTER_HTTP" != "201" && "$M_REGISTER_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-register.json"
  fail "Transporter registration failed. HTTP $M_REGISTER_HTTP"
fi

for _ in $(seq 1 30); do
  if [[ -s "$CAPTURE_FILE" ]]; then
    break
  fi
  sleep 0.5
done

if [[ ! -s "$CAPTURE_FILE" ]]; then
  fail "Verification URL was not captured for the transporter account."
fi

M_VERIFICATION_URL="$(cat "$CAPTURE_FILE")"
M_VERIFICATION_TOKEN="${M_VERIFICATION_URL##*token=}"

if [[ -z "$M_VERIFICATION_TOKEN" ]]; then
  fail "Transporter verification token could not be extracted."
fi

M_VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/m-verify.json" -w "%{http_code}" \
    --get \
    --data-urlencode "token=$M_VERIFICATION_TOKEN" \
    "$API_URL$API_PREFIX/auth/verify-email"
)"

if [[ "$M_VERIFY_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-verify.json"
  fail "Transporter email verification failed. HTTP $M_VERIFY_HTTP"
fi

echo "✓ Transporter account registered and email-verified"

echo
echo "[M2/10] Admin promotes the account (the only onboarding path)..."

M_USER_ID="$(
  psql "${E2E_PSQL_TARGET:-bonagri}" -v ON_ERROR_STOP=1 -At \
    -v email="$M_EMAIL" <<'SQL'
SELECT id FROM "User" WHERE email = :'email';
SQL
)"

M_USER_ID="${M_USER_ID//$'\n'/}"

if [[ -z "$M_USER_ID" ]]; then
  fail "Transporter user id not found in the database."
fi

M_PROMOTE_HTTP="$(
  curl -sS -o "$LOG_DIR/m-promote.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/users/$M_USER_ID/promote-transporter" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d '{"businessName":"Mosa Hauliers","vehicleType":"1-tonne truck","city":"Polokwane","province":"Limpopo","serviceProvinces":["Limpopo"]}'
)"

if [[ "$M_PROMOTE_HTTP" != "201" && "$M_PROMOTE_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-promote.json"
  fail "Promote to transporter failed. HTTP $M_PROMOTE_HTTP"
fi

if ! grep -q '"role"[[:space:]]*:[[:space:]]*"TRANSPORTER"' "$LOG_DIR/m-promote.json"; then
  cat "$LOG_DIR/m-promote.json"
  fail "Promotion did not set role TRANSPORTER."
fi

M_PROMOTE_AGAIN_HTTP="$(
  curl -sS -o "$LOG_DIR/m-promote-again.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/users/$M_USER_ID/promote-transporter" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d '{"businessName":"Mosa Hauliers","serviceProvinces":["Limpopo"]}'
)"

if [[ "$M_PROMOTE_AGAIN_HTTP" != "409" ]]; then
  cat "$LOG_DIR/m-promote-again.json"
  fail "Re-promoting must 409 (profile created exactly once). HTTP $M_PROMOTE_AGAIN_HTTP"
fi

echo "✓ Admin promoted user to TRANSPORTER (repeat promote → 409)"

echo
echo "[M3/10] Transporter logs in; unverified profile sees no board..."

M_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/m-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$M_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"
)"

if [[ "$M_LOGIN_HTTP" != "201" && "$M_LOGIN_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-login.json"
  fail "Transporter login failed. HTTP $M_LOGIN_HTTP"
fi

M_TOKEN="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("accessToken",""))' "$LOG_DIR/m-login.json"
)"

if [[ -z "$M_TOKEN" ]]; then
  cat "$LOG_DIR/m-login.json"
  fail "Transporter access token missing."
fi

if ! grep -q '"role"[[:space:]]*:[[:space:]]*"TRANSPORTER"' "$LOG_DIR/m-login.json"; then
  cat "$LOG_DIR/m-login.json"
  fail "Login did not return role TRANSPORTER."
fi

M_UNVERIFIED_BOARD_HTTP="$(
  curl -sS -o "$LOG_DIR/m-board-unverified.json" -w "%{http_code}" \
    -H "Authorization: Bearer $M_TOKEN" \
    "$API_URL$API_PREFIX/transport/jobs"
)"

if [[ "$M_UNVERIFIED_BOARD_HTTP" != "403" ]]; then
  cat "$LOG_DIR/m-board-unverified.json"
  fail "Unverified transporter must get 403. HTTP $M_UNVERIFIED_BOARD_HTTP"
fi

echo "✓ Transporter logged in; unverified profile blocked from board (403)"

echo
echo "[M4/10] Admin verifies the transporter..."

M_TRANSPORTERS_HTTP="$(
  curl -sS -o "$LOG_DIR/m-transporters.json" -w "%{http_code}" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$API_URL$API_PREFIX/admin/transporters"
)"

if [[ "$M_TRANSPORTERS_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-transporters.json"
  fail "Admin transporter list failed. HTTP $M_TRANSPORTERS_HTTP"
fi

M_PROFILE_ID="$(
  python3 - "$LOG_DIR/m-transporters.json" "$M_EMAIL" <<'PYJSON'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)

if not isinstance(data, list):
    raise SystemExit("Admin transporter list is not an array.")

found = None
for profile in data:
    if (profile.get("user") or {}).get("email") == sys.argv[2]:
        found = profile["id"]
        break

if not found:
    raise SystemExit("Promoted transporter profile not found in admin list.")

print(found)
PYJSON
)"

M_VERIFY_PROFILE_HTTP="$(
  curl -sS -o "$LOG_DIR/m-verify-profile.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/admin/transporters/$M_PROFILE_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d '{"verified":true}'
)"

if [[ "$M_VERIFY_PROFILE_HTTP" != "200" && "$M_VERIFY_PROFILE_HTTP" != "201" ]]; then
  cat "$LOG_DIR/m-verify-profile.json"
  fail "Transporter verification failed. HTTP $M_VERIFY_PROFILE_HTTP"
fi

if ! grep -q '"verified"[[:space:]]*:[[:space:]]*true' "$LOG_DIR/m-verify-profile.json"; then
  cat "$LOG_DIR/m-verify-profile.json"
  fail "Verification response did not confirm verified state."
fi

echo "✓ Transporter profile verified by admin"

echo
echo "[M5/10] Fresh buyer order advances to READY_FOR_DELIVERY..."

M_ORDER1_HTTP="$(
  curl -sS -o "$LOG_DIR/m-order1-create.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"productId\":\"$PRODUCT_ID\",\"quantity\":1,\"notes\":\"CP14 transport smoke order\"}"
)"

if [[ "$M_ORDER1_HTTP" != "201" ]]; then
  cat "$LOG_DIR/m-order1-create.json"
  fail "CP14 buyer order creation failed. HTTP $M_ORDER1_HTTP"
fi

M_ORDER1_ID="$(
  python3 - "$LOG_DIR/m-order1-create.json" <<'PYJSON'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)

order = data.get("order") if isinstance(data.get("order"), dict) else data

if not order.get("id"):
    raise SystemExit("CP14 order id missing from creation response.")

print(order["id"])
PYJSON
)"

for M_STEP in CONFIRMED PROCESSING READY_FOR_DELIVERY; do
  M_STEP_HTTP="$(
    curl -sS -o "$LOG_DIR/m-order1-$M_STEP.json" -w "%{http_code}" \
      -X PATCH "$API_URL$API_PREFIX/orders/$M_ORDER1_ID/status" \
      -H "Authorization: Bearer $SUPPLIER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"$M_STEP\"}"
  )"

  if [[ "$M_STEP_HTTP" != "200" ]]; then
    cat "$LOG_DIR/m-order1-$M_STEP.json"
    fail "CP14 supplier transition to $M_STEP failed. HTTP $M_STEP_HTTP"
  fi
done

echo "✓ Order ready for delivery (Limpopo address)"

echo
echo "[M6/10] Publish the job + endpoint guards..."

M_PUBLISH_HTTP="$(
  curl -sS -o "$LOG_DIR/m-publish.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$M_ORDER1_ID/delivery/publish" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_PUBLISH_HTTP" != "201" && "$M_PUBLISH_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-publish.json"
  fail "Publish delivery job failed. HTTP $M_PUBLISH_HTTP"
fi

if ! grep -q '"publishedAt"[[:space:]]*:[[:space:]]*"' "$LOG_DIR/m-publish.json"; then
  cat "$LOG_DIR/m-publish.json"
  fail "Publish response has no publishedAt timestamp."
fi

M_PUBLISH_AGAIN_HTTP="$(
  curl -sS -o "$LOG_DIR/m-publish-again.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$M_ORDER1_ID/delivery/publish" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_PUBLISH_AGAIN_HTTP" != "409" ]]; then
  cat "$LOG_DIR/m-publish-again.json"
  fail "Re-publish of a live job must 409. HTTP $M_PUBLISH_AGAIN_HTTP"
fi

M_ANON_BOARD_HTTP="$(
  curl -sS -o "$LOG_DIR/m-board-anon.json" -w "%{http_code}" \
    "$API_URL$API_PREFIX/transport/jobs"
)"

if [[ "$M_ANON_BOARD_HTTP" != "401" ]]; then
  fail "Anonymous claim board must 401. HTTP $M_ANON_BOARD_HTTP"
fi

M_BUYER_PUBLISH_HTTP="$(
  curl -sS -o "$LOG_DIR/m-buyer-publish.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$M_ORDER1_ID/delivery/publish" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_BUYER_PUBLISH_HTTP" != "403" ]]; then
  cat "$LOG_DIR/m-buyer-publish.json"
  fail "Buyer publish attempt must 403. HTTP $M_BUYER_PUBLISH_HTTP"
fi

M_FOREIGN_PUBLISH_HTTP="$(
  curl -sS -o "$LOG_DIR/m-foreign-publish.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$M_ORDER1_ID/delivery/publish" \
    -H "Authorization: Bearer $DEALER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_FOREIGN_PUBLISH_HTTP" != "404" ]]; then
  cat "$LOG_DIR/m-foreign-publish.json"
  fail "Foreign supplier publish attempt must 404. HTTP $M_FOREIGN_PUBLISH_HTTP"
fi

echo "✓ Job published once (re-publish 409); anon 401, buyer 403, foreign 404"

echo
echo "[M7/10] Claim board respects the transporter's service provinces..."

psql "${E2E_PSQL_TARGET:-bonagri}" -v ON_ERROR_STOP=1 -q \
  -v email="$M_EMAIL" <<'SQL'
UPDATE "TransporterProfile" tp
SET "serviceProvinces" = '{Western Cape}'
FROM "User" u
WHERE tp."userId" = u.id AND u.email = :'email';
SQL

M_JOBS_OFF="$(
  curl -sS -H "Authorization: Bearer $M_TOKEN" \
    "$API_URL$API_PREFIX/transport/jobs"
)"

if echo "$M_JOBS_OFF" | grep -q "$M_ORDER1_ID"; then
  echo "$M_JOBS_OFF"
  fail "Job outside the service provinces must not appear on the board."
fi

psql "${E2E_PSQL_TARGET:-bonagri}" -v ON_ERROR_STOP=1 -q \
  -v email="$M_EMAIL" <<'SQL'
UPDATE "TransporterProfile" tp
SET "serviceProvinces" = '{Limpopo}'
FROM "User" u
WHERE tp."userId" = u.id AND u.email = :'email';
SQL

M_JOBS_ON="$(
  curl -sS -H "Authorization: Bearer $M_TOKEN" \
    "$API_URL$API_PREFIX/transport/jobs"
)"

if ! echo "$M_JOBS_ON" | grep -q "$M_ORDER1_ID"; then
  echo "$M_JOBS_ON"
  fail "Published Limpopo job missing from the Limpopo transporter's board."
fi

# City-level projection only — the full address must never leave the board.
if echo "$M_JOBS_ON" | grep -q "addressLine1" || echo "$M_JOBS_ON" | grep -q "E2E Buyer"; then
  echo "$M_JOBS_ON"
  fail "Claim board leaked full address or buyer contact details."
fi

echo "✓ Board is province-filtered and city-level only (no address leak)"

echo
echo "[M8/10] Atomic claim + ownership handoff guards..."

M_CLAIM_HTTP="$(
  curl -sS -o "$LOG_DIR/m-claim.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/transport/jobs/$M_ORDER1_ID/claim" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_CLAIM_HTTP" != "201" && "$M_CLAIM_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-claim.json"
  fail "Claim failed. HTTP $M_CLAIM_HTTP"
fi

if ! grep -q '"status"[[:space:]]*:[[:space:]]*"ASSIGNED"' "$LOG_DIR/m-claim.json"; then
  cat "$LOG_DIR/m-claim.json"
  fail "Claim did not assign the delivery."
fi

M_CLAIM_AGAIN_HTTP="$(
  curl -sS -o "$LOG_DIR/m-claim-again.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/transport/jobs/$M_ORDER1_ID/claim" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_CLAIM_AGAIN_HTTP" != "409" ]]; then
  cat "$LOG_DIR/m-claim-again.json"
  fail "Second claim must 409. HTTP $M_CLAIM_AGAIN_HTTP"
fi

M_SUP_OUT_HTTP="$(
  curl -sS -o "$LOG_DIR/m-sup-out.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$M_ORDER1_ID/status" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"OUT_FOR_DELIVERY"}'
)"

if [[ "$M_SUP_OUT_HTTP" != "403" ]]; then
  cat "$LOG_DIR/m-sup-out.json"
  fail "Supplier must be locked out of OUT_FOR_DELIVERY after claim. HTTP $M_SUP_OUT_HTTP"
fi

M_SUP_DEL_HTTP="$(
  curl -sS -o "$LOG_DIR/m-sup-del.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$M_ORDER1_ID/status" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"DELIVERED"}'
)"

if [[ "$M_SUP_DEL_HTTP" != "403" ]]; then
  cat "$LOG_DIR/m-sup-del.json"
  fail "Supplier must be locked out of DELIVERED after claim. HTTP $M_SUP_DEL_HTTP"
fi

echo "✓ Claim atomic (repeat 409); supplier locked out (403) once claimed"

echo
echo "[M9/10] Transporter drives pickup → transit → complete..."

M_PICKUP_HTTP="$(
  curl -sS -o "$LOG_DIR/m-pickup.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$M_ORDER1_ID/delivery/pickup" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_PICKUP_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-pickup.json"
  fail "Pickup failed. HTTP $M_PICKUP_HTTP"
fi

if ! grep -q '"status"[[:space:]]*:[[:space:]]*"PICKED_UP"' "$LOG_DIR/m-pickup.json"; then
  cat "$LOG_DIR/m-pickup.json"
  fail "Pickup did not move the delivery to PICKED_UP."
fi

M_ORDER1_STATE="$(
  curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API_URL$API_PREFIX/orders/$M_ORDER1_ID"
)"

if ! echo "$M_ORDER1_STATE" | grep -q '"status"[[:space:]]*:[[:space:]]*"OUT_FOR_DELIVERY"'; then
  echo "$M_ORDER1_STATE"
  fail "Pickup did not flip the order to OUT_FOR_DELIVERY."
fi

M_HISTORY_COUNT="$(
  psql "${E2E_PSQL_TARGET:-bonagri}" -v ON_ERROR_STOP=1 -At \
    -v order_id="$M_ORDER1_ID" <<'SQL'
SELECT COUNT(*)
FROM "OrderStatusHistory"
WHERE "orderId" = :'order_id'
  AND "actorRole" = 'TRANSPORTER'
  AND "toStatus" = 'OUT_FOR_DELIVERY';
SQL
)"

M_HISTORY_COUNT="${M_HISTORY_COUNT//$'\n'/}"

if [[ -z "$M_HISTORY_COUNT" || "$M_HISTORY_COUNT" -lt 1 ]]; then
  fail "No TRANSPORTER OutForDelivery history row was recorded."
fi

M_TRANSIT_HTTP="$(
  curl -sS -o "$LOG_DIR/m-transit.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$M_ORDER1_ID/delivery/transit" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_TRANSIT_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-transit.json"
  fail "Transit transition failed. HTTP $M_TRANSIT_HTTP"
fi

M_COMPLETE_HTTP="$(
  curl -sS -o "$LOG_DIR/m-complete.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$M_ORDER1_ID/delivery/complete" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_COMPLETE_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-complete.json"
  fail "Complete failed. HTTP $M_COMPLETE_HTTP"
fi

M_ORDER1_FINAL="$(
  curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API_URL$API_PREFIX/orders/$M_ORDER1_ID"
)"

if ! echo "$M_ORDER1_FINAL" | grep -q '"status"[[:space:]]*:[[:space:]]*"DELIVERED"'; then
  echo "$M_ORDER1_FINAL"
  fail "Complete did not flip the order to DELIVERED."
fi

echo "✓ Pickup flips order + history; transit; complete → DELIVERED"

echo
echo "[M10/10] Failure loop: fail → re-dispatch → retry → deliver..."

M_ORDER2_HTTP="$(
  curl -sS -o "$LOG_DIR/m-order2-create.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"productId\":\"$PRODUCT_ID\",\"quantity\":1,\"notes\":\"CP14 transport failure smoke order\"}"
)"

if [[ "$M_ORDER2_HTTP" != "201" ]]; then
  cat "$LOG_DIR/m-order2-create.json"
  fail "Second CP14 order creation failed. HTTP $M_ORDER2_HTTP"
fi

M_ORDER2_ID="$(
  python3 - "$LOG_DIR/m-order2-create.json" <<'PYJSON'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)

order = data.get("order") if isinstance(data.get("order"), dict) else data

if not order.get("id"):
    raise SystemExit("Second CP14 order id missing.")

print(order["id"])
PYJSON
)"

for M_STEP in CONFIRMED PROCESSING READY_FOR_DELIVERY; do
  M_STEP_HTTP="$(
    curl -sS -o "$LOG_DIR/m-order2-$M_STEP.json" -w "%{http_code}" \
      -X PATCH "$API_URL$API_PREFIX/orders/$M_ORDER2_ID/status" \
      -H "Authorization: Bearer $SUPPLIER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"$M_STEP\"}"
  )"

  if [[ "$M_STEP_HTTP" != "200" ]]; then
    cat "$LOG_DIR/m-order2-$M_STEP.json"
    fail "CP14 supplier transition to $M_STEP (order 2) failed. HTTP $M_STEP_HTTP"
  fi
done

M_PUBLISH2_HTTP="$(
  curl -sS -o "$LOG_DIR/m-publish2.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$M_ORDER2_ID/delivery/publish" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_PUBLISH2_HTTP" != "201" && "$M_PUBLISH2_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-publish2.json"
  fail "Second publish failed. HTTP $M_PUBLISH2_HTTP"
fi

M_CLAIM2_HTTP="$(
  curl -sS -o "$LOG_DIR/m-claim2.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/transport/jobs/$M_ORDER2_ID/claim" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_CLAIM2_HTTP" != "201" && "$M_CLAIM2_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-claim2.json"
  fail "Second claim failed. HTTP $M_CLAIM2_HTTP"
fi

M_PICKUP2_HTTP="$(
  curl -sS -o "$LOG_DIR/m-pickup2-first.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$M_ORDER2_ID/delivery/pickup" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_PICKUP2_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-pickup2-first.json"
  fail "Second pickup failed. HTTP $M_PICKUP2_HTTP"
fi

M_TRANSIT2_HTTP="$(
  curl -sS -o "$LOG_DIR/m-transit2.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$M_ORDER2_ID/delivery/transit" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_TRANSIT2_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-transit2.json"
  fail "Second transit failed. HTTP $M_TRANSIT2_HTTP"
fi

M_FAIL_HTTP="$(
  curl -sS -o "$LOG_DIR/m-fail.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$M_ORDER2_ID/delivery/fail" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"reason":"CP14 smoke: truck broke down on the N1"}'
)"

if [[ "$M_FAIL_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-fail.json"
  fail "Delivery failure reporting failed. HTTP $M_FAIL_HTTP"
fi

if ! grep -q '"status"[[:space:]]*:[[:space:]]*"FAILED"' "$LOG_DIR/m-fail.json" \
  || ! grep -q "truck broke down" "$LOG_DIR/m-fail.json"; then
  cat "$LOG_DIR/m-fail.json"
  fail "Failure report did not record status FAILED with the reason."
fi

M_ORDER2_STATE="$(
  curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API_URL$API_PREFIX/orders/$M_ORDER2_ID"
)"

if ! echo "$M_ORDER2_STATE" | grep -q '"status"[[:space:]]*:[[:space:]]*"OUT_FOR_DELIVERY"'; then
  echo "$M_ORDER2_STATE"
  fail "Failed delivery must leave the order at OUT_FOR_DELIVERY (no backward move)."
fi

if ! echo "$M_ORDER2_STATE" | grep -q "truck broke down"; then
  echo "$M_ORDER2_STATE"
  fail "Buyer order view is missing the delivery failure reason."
fi

echo "✓ Failure recorded with reason; order never moves backwards"

M_REDISPATCH_HTTP="$(
  curl -sS -o "$LOG_DIR/m-redispatch.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$M_ORDER2_ID/delivery/re-dispatch" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_REDISPATCH_HTTP" != "201" && "$M_REDISPATCH_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-redispatch.json"
  fail "Re-dispatch back to board failed. HTTP $M_REDISPATCH_HTTP"
fi

if ! grep -q '"status"[[:space:]]*:[[:space:]]*"PENDING"' "$LOG_DIR/m-redispatch.json" \
  || ! grep -q '"transporterId"[[:space:]]*:[[:space:]]*null' "$LOG_DIR/m-redispatch.json"; then
  cat "$LOG_DIR/m-redispatch.json"
  fail "Re-dispatch did not return the job to the unclaimed board state."
fi

M_REPUBLISH_HTTP="$(
  curl -sS -o "$LOG_DIR/m-republish.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders/$M_ORDER2_ID/delivery/publish" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_REPUBLISH_HTTP" != "201" && "$M_REPUBLISH_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-republish.json"
  fail "Re-publish after failure failed. HTTP $M_REPUBLISH_HTTP"
fi

M_RECLAIM_HTTP="$(
  curl -sS -o "$LOG_DIR/m-reclaim.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/transport/jobs/$M_ORDER2_ID/claim" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_RECLAIM_HTTP" != "201" && "$M_RECLAIM_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-reclaim.json"
  fail "Re-claim after failure failed. HTTP $M_RECLAIM_HTTP"
fi

M_PICKUP2_RETRY_HTTP="$(
  curl -sS -o "$LOG_DIR/m-pickup2-retry.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$M_ORDER2_ID/delivery/pickup" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_PICKUP2_RETRY_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-pickup2-retry.json"
  fail "Retry pickup after failure failed. HTTP $M_PICKUP2_RETRY_HTTP"
fi

python3 - "$LOG_DIR/m-pickup2-first.json" "$LOG_DIR/m-pickup2-retry.json" <<'PYJSON'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    first = json.load(f)
with open(sys.argv[2], encoding="utf-8") as f:
    retry = json.load(f)

if first.get("pickedUpAt") != retry.get("pickedUpAt"):
    raise SystemExit(
        "pickedUpAt was overwritten on retry pickup: "
        "{} != {}".format(first.get("pickedUpAt"), retry.get("pickedUpAt"))
    )

print("✓ Retry pickup kept the original pickup time")
PYJSON

M_COMPLETE2_HTTP="$(
  curl -sS -o "$LOG_DIR/m-complete2.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/orders/$M_ORDER2_ID/delivery/complete" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}'
)"

if [[ "$M_COMPLETE2_HTTP" != "200" ]]; then
  cat "$LOG_DIR/m-complete2.json"
  fail "Retry completion failed. HTTP $M_COMPLETE2_HTTP"
fi

M_ORDER2_FINAL="$(
  curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API_URL$API_PREFIX/orders/$M_ORDER2_ID"
)"

if ! echo "$M_ORDER2_FINAL" | grep -q '"status"[[:space:]]*:[[:space:]]*"DELIVERED"'; then
  echo "$M_ORDER2_FINAL"
  fail "Order 2 did not reach DELIVERED after the retry loop."
fi

if ! echo "$M_ORDER2_FINAL" | grep -q "truck broke down"; then
  echo "$M_ORDER2_FINAL"
  fail "The recorded failure reason disappeared after completion (audit trail)."
fi

echo "✓ Failed job re-dispatched, re-claimed, retried and delivered"

echo
echo "✓ TRANSPORTER DELIVERY FLOW ACCEPTANCE PASSED"

echo
echo "========================================"
echo "CHECKPOINT LEDGER FLOW (CP15a)"
echo "========================================"

# CP15a: evidence ledger rides BESIDE the CP14 state machine — checkpoints
# never move OrderStatus/DeliveryStatus. Runs after M (reuses its journey
# transporter + delivered order) and before the admin section (needs the
# main smoke buyer to still be a BUYER). Pins: supplier farm pin via
# PATCH /catalog/supplier/pin, delivery pin via PATCH /addresses/:id.

echo
echo "[N1/9] Supplier farm pin + delivery id..."

N_PIN_HTTP="$(
  curl -sS -o "$LOG_DIR/n-supplier-pin.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/supplier/pin" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"lat":-23.88,"lng":29.45}'
)"

if [[ "$N_PIN_HTTP" != "200" ]]; then
  cat "$LOG_DIR/n-supplier-pin.json"
  fail "Supplier farm pin update failed. HTTP $N_PIN_HTTP"
fi

if ! grep -q '"lat"[[:space:]]*:[[:space:]]*-23.88' "$LOG_DIR/n-supplier-pin.json"; then
  cat "$LOG_DIR/n-supplier-pin.json"
  fail "Supplier pin response did not carry the stored coordinates."
fi

N_DELIVERY_ID="$(
  curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API_URL$API_PREFIX/orders/$M_ORDER2_ID/delivery" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))'
)"

if [[ -z "$N_DELIVERY_ID" ]]; then
  fail "Could not resolve the M order-2 delivery id."
fi

echo "✓ Farm pin stored; delivery $N_DELIVERY_ID in scope"

echo
echo "[N2/9] Endpoint guards + create-only surface..."

N_ANON_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints" \
    -H "Content-Type: application/json" \
    -d '{"type":"PICKED_UP"}'
)"

if [[ "$N_ANON_HTTP" != "401" ]]; then
  fail "Anonymous checkpoint write must 401. HTTP $N_ANON_HTTP"
fi

N_ANON_READ_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints"
)"

if [[ "$N_ANON_READ_HTTP" != "401" ]]; then
  fail "Anonymous checkpoint read must 401. HTTP $N_ANON_READ_HTTP"
fi

N_BUYER_WRITE_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"PICKED_UP"}'
)"

if [[ "$N_BUYER_WRITE_HTTP" != "403" ]]; then
  fail "Buyer checkpoint write must 403 (roles). HTTP $N_BUYER_WRITE_HTTP"
fi

N_GHOST_READ_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API_URL$API_PREFIX/deliveries/00000000-0000-0000-0000-000000000000/checkpoints"
)"

if [[ "$N_GHOST_READ_HTTP" != "404" ]]; then
  fail "Unknown delivery read must 404. HTTP $N_GHOST_READ_HTTP"
fi

N_PATCH_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"note":"tamper"}'
)"

if [[ "$N_PATCH_HTTP" != "404" ]]; then
  fail "The ledger must be create-only — PATCH route must not exist. HTTP $N_PATCH_HTTP"
fi

N_DELETE_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X DELETE "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints" \
    -H "Authorization: Bearer $M_TOKEN"
)"

if [[ "$N_DELETE_HTTP" != "404" ]]; then
  fail "The ledger must be create-only — DELETE route must not exist. HTTP $N_DELETE_HTTP"
fi

echo "✓ Guards hold (401/403/404) and no update/delete route exists"

echo
echo "[N3/9] Transporter pickup checkpoint next to the farm pin..."

N_PICKUP_HTTP="$(
  curl -sS -o "$LOG_DIR/n-pickup.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"PICKED_UP","lat":-23.8805,"lng":29.4505,"accuracyM":10,"note":"crates loaded"}'
)"

if [[ "$N_PICKUP_HTTP" != "201" ]]; then
  cat "$LOG_DIR/n-pickup.json"
  fail "Pickup checkpoint write failed. HTTP $N_PICKUP_HTTP"
fi

python3 - "$LOG_DIR/n-pickup.json" <<'PYJSON'
import json, sys

cp = json.load(open(sys.argv[1], encoding="utf-8"))
flags = cp.get("flags", [])

if cp.get("actorRole") != "TRANSPORTER":
    raise SystemExit("ERROR: checkpoint actorRole must be TRANSPORTER")
if "NO_PHOTO" not in flags:
    raise SystemExit("ERROR: CP15a has no photo upload yet — NO_PHOTO must fire: {}".format(flags))
if "GEO_FAR_PICKUP" in flags:
    raise SystemExit("ERROR: checkpoint 50m from the farm pin flagged GEO_FAR_PICKUP: {}".format(flags))

print("✓ Pickup checkpoint stored (flags: {})".format(", ".join(flags)))
PYJSON

echo
echo "[N4/9] Geo flags: far pickup + impossible speed..."

N_FAR_HTTP="$(
  curl -sS -o "$LOG_DIR/n-far.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"PICKED_UP","lat":-24.6,"lng":29.45,"accuracyM":10}'
)"

if [[ "$N_FAR_HTTP" != "201" ]]; then
  cat "$LOG_DIR/n-far.json"
  fail "Far pickup checkpoint write failed. HTTP $N_FAR_HTTP"
fi

python3 - "$LOG_DIR/n-far.json" <<'PYJSON'
import json, sys

flags = json.load(open(sys.argv[1], encoding="utf-8")).get("flags", [])

if "GEO_FAR_PICKUP" not in flags:
    raise SystemExit("ERROR: pickup ~80km from the farm pin must flag GEO_FAR_PICKUP: {}".format(flags))

print("✓ Far pickup flagged ({})".format(", ".join(flags)))
PYJSON

N_TRANSIT_FAR_HTTP="$(
  curl -sS -o "$LOG_DIR/n-transit-far.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"IN_TRANSIT","lat":-23.0,"lng":29.45,"accuracyM":10}'
)"

if [[ "$N_TRANSIT_FAR_HTTP" != "201" ]]; then
  cat "$LOG_DIR/n-transit-far.json"
  fail "Transit checkpoint write failed. HTTP $N_TRANSIT_FAR_HTTP"
fi

python3 - "$LOG_DIR/n-transit-far.json" <<'PYJSON'
import json, sys

flags = json.load(open(sys.argv[1], encoding="utf-8")).get("flags", [])

if "IMPOSSIBLE_SPEED" not in flags:
    raise SystemExit("ERROR: ~100km jump within seconds must flag IMPOSSIBLE_SPEED: {}".format(flags))

print("✓ Impossible speed flagged ({})".format(", ".join(flags)))
PYJSON

echo
echo "[N5/9] Clock skew + low accuracy..."

N_SKEW_AT="$(date -u -v-30M +%Y-%m-%dT%H:%M:%SZ)"

N_SKEW_HTTP="$(
  curl -sS -o "$LOG_DIR/n-skew.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"IN_TRANSIT\",\"lat\":-23.881,\"lng\":29.451,\"accuracyM\":10,\"clientAt\":\"$N_SKEW_AT\"}"
)"

if [[ "$N_SKEW_HTTP" != "201" ]]; then
  cat "$LOG_DIR/n-skew.json"
  fail "Skewed checkpoint write failed. HTTP $N_SKEW_HTTP"
fi

python3 - "$LOG_DIR/n-skew.json" <<'PYJSON'
import json, sys

flags = json.load(open(sys.argv[1], encoding="utf-8")).get("flags", [])

if "CLOCK_SKEW" not in flags:
    raise SystemExit("ERROR: clientAt 30min behind recordedAt must flag CLOCK_SKEW: {}".format(flags))

print("✓ Clock skew flagged ({})".format(", ".join(flags)))
PYJSON

N_ACC_HTTP="$(
  curl -sS -o "$LOG_DIR/n-acc.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"IN_TRANSIT","lat":-23.882,"lng":29.452,"accuracyM":250}'
)"

if [[ "$N_ACC_HTTP" != "201" ]]; then
  cat "$LOG_DIR/n-acc.json"
  fail "Low-accuracy checkpoint write failed. HTTP $N_ACC_HTTP"
fi

python3 - "$LOG_DIR/n-acc.json" <<'PYJSON'
import json, sys

flags = json.load(open(sys.argv[1], encoding="utf-8")).get("flags", [])

if "LOW_ACCURACY" not in flags:
    raise SystemExit("ERROR: accuracyM 250 must flag LOW_ACCURACY: {}".format(flags))

print("✓ Low accuracy flagged ({})".format(", ".join(flags)))
PYJSON

echo
echo "[N6/9] Delivery checkpoints vs the delivery address pin..."

N_NOPIN_HTTP="$(
  curl -sS -o "$LOG_DIR/n-nopin.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"DELIVERED","lat":-23.9,"lng":29.46,"accuracyM":10}'
)"

if [[ "$N_NOPIN_HTTP" != "201" ]]; then
  cat "$LOG_DIR/n-nopin.json"
  fail "Delivered checkpoint write failed. HTTP $N_NOPIN_HTTP"
fi

python3 - "$LOG_DIR/n-nopin.json" <<'PYJSON'
import json, sys

flags = json.load(open(sys.argv[1], encoding="utf-8")).get("flags", [])

if "NO_REFERENCE_PIN" not in flags:
    raise SystemExit("ERROR: DELIVERED with no address pin must flag NO_REFERENCE_PIN: {}".format(flags))

print("✓ Missing reference pin flagged ({})".format(", ".join(flags)))
PYJSON

# CP15a pin pairing: a lone coordinate must be rejected before the
# complete pair is accepted.
N_PARTIAL_PIN_HTTP="$(
  curl -sS -o "$LOG_DIR/n-addr-pin-partial.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/addresses/$ADDRESS_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"lat":-23.9}'
)"

if [[ "$N_PARTIAL_PIN_HTTP" != "400" ]]; then
  cat "$LOG_DIR/n-addr-pin-partial.json"
  fail "Partial coordinate pair must be rejected with 400. HTTP $N_PARTIAL_PIN_HTTP"
fi

echo "✓ Partial lat/lng pair rejected (400)"

N_ADDR_PIN_HTTP="$(
  curl -sS -o "$LOG_DIR/n-addr-pin.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/addresses/$ADDRESS_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"lat":-23.9,"lng":29.46}'
)"

if [[ "$N_ADDR_PIN_HTTP" != "200" ]]; then
  cat "$LOG_DIR/n-addr-pin.json"
  fail "Address pin update failed. HTTP $N_ADDR_PIN_HTTP"
fi

if ! grep -q '"lat"[[:space:]]*:[[:space:]]*-23.9' "$LOG_DIR/n-addr-pin.json" || \
   ! grep -q '"lng"[[:space:]]*:[[:space:]]*29.46' "$LOG_DIR/n-addr-pin.json"; then
  cat "$LOG_DIR/n-addr-pin.json"
  fail "Address pin response did not carry both stored coordinates."
fi

N_NEAR_DROP_HTTP="$(
  curl -sS -o "$LOG_DIR/n-near-drop.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints" \
    -H "Authorization: Bearer $M_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"DELIVERED","lat":-23.9005,"lng":29.4605,"accuracyM":10}'
)"

if [[ "$N_NEAR_DROP_HTTP" != "201" ]]; then
  cat "$LOG_DIR/n-near-drop.json"
  fail "Near-drop checkpoint write failed. HTTP $N_NEAR_DROP_HTTP"
fi

python3 - "$LOG_DIR/n-near-drop.json" <<'PYJSON'
import json, sys

flags = json.load(open(sys.argv[1], encoding="utf-8")).get("flags", [])

if flags != ["NO_PHOTO"]:
    raise SystemExit("ERROR: on-pin delivery checkpoint with fresh state should be clean (only NO_PHOTO): {}".format(flags))

print("✓ On-pin delivery checkpoint clean (NO_PHOTO only)")
PYJSON

N_LEDGER="$(
  curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints"
)"

echo "$N_LEDGER" > "$LOG_DIR/n-ledger.json"

python3 - "$LOG_DIR/n-ledger.json" <<'PYJSON'
import json, sys

rows = json.load(open(sys.argv[1], encoding="utf-8"))

if not isinstance(rows, list) or len(rows) < 7:
    raise SystemExit("ERROR: buyer ledger read must list every checkpoint (got {})".format(len(rows) if isinstance(rows, list) else rows))
if rows[0].get("type") != "PICKED_UP":
    raise SystemExit("ERROR: ledger must be ordered by recordedAt asc")
if any("actorUserId" in row for row in rows):
    raise SystemExit("ERROR: actorUserId must never leak to the audience")

print("✓ Buyer reads the full {}-row ledger (ordered, no actor ids)".format(len(rows)))
PYJSON

echo
echo "[N7/9] Checkpoints never drive the state machine..."

N_SELF_ORDER_HTTP="$(
  curl -sS -o "$LOG_DIR/n-self-order.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/orders" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deliveryAddressId\":\"$ADDRESS_ID\",\"productId\":\"$PRODUCT_ID\",\"quantity\":1,\"notes\":\"CP15a self-delivery checkpoint order\"}"
)"

if [[ "$N_SELF_ORDER_HTTP" != "201" ]]; then
  cat "$LOG_DIR/n-self-order.json"
  fail "Self-delivery order creation failed. HTTP $N_SELF_ORDER_HTTP"
fi

N_SELF_ORDER_ID="$(
  python3 - "$LOG_DIR/n-self-order.json" <<'PYJSON'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)

order = data.get("order") if isinstance(data.get("order"), dict) else data

if not order.get("id"):
    raise SystemExit("CP15a order id missing from creation response.")

print(order["id"])
PYJSON
)"

for N_STEP in CONFIRMED PROCESSING READY_FOR_DELIVERY; do
  N_STEP_HTTP="$(
    curl -sS -o "$LOG_DIR/n-self-$N_STEP.json" -w "%{http_code}" \
      -X PATCH "$API_URL$API_PREFIX/orders/$N_SELF_ORDER_ID/status" \
      -H "Authorization: Bearer $SUPPLIER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"$N_STEP\"}"
  )"

  if [[ "$N_STEP_HTTP" != "200" ]]; then
    cat "$LOG_DIR/n-self-$N_STEP.json"
    fail "Self-delivery transition to $N_STEP failed. HTTP $N_STEP_HTTP"
  fi
done

N_SELF_DELIVERY_ID="$(
  curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API_URL$API_PREFIX/orders/$N_SELF_ORDER_ID/delivery" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))'
)"

if [[ -z "$N_SELF_DELIVERY_ID" ]]; then
  fail "READY_FOR_DELIVERY did not seed a delivery row."
fi

echo
echo "[N8/9] Order destination snapshot survives address edits..."

curl -sS -o "$LOG_DIR/n-snap-before.json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$API_URL$API_PREFIX/orders/$N_SELF_ORDER_ID"

N_SNAP_BEFORE="$(
  python3 - "$LOG_DIR/n-snap-before.json" <<'PYJSON'
import json, sys

order = json.load(open(sys.argv[1], encoding="utf-8"))
address = order.get("deliveryAddress") or {}

if address.get("city") != "Giyani":
    raise SystemExit("ERROR: order must carry the pinned address text, got: {}".format(address.get("city")))
if address.get("lat") != -23.9 or address.get("lng") != 29.46:
    raise SystemExit("ERROR: order must carry the pinned coordinates, got: {}, {}".format(address.get("lat"), address.get("lng")))

print("{}|{}|{}".format(address["city"], address["lat"], address["lng"]))
PYJSON
)"

if [[ -z "$N_SNAP_BEFORE" ]]; then
  fail "Could not read the order's destination snapshot before mutation."
fi

N_SNAP_EDIT_HTTP="$(
  curl -sS -o "$LOG_DIR/n-snap-edit.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/addresses/$ADDRESS_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"city":"Snapshot Edit City","lat":-24.55,"lng":29.55}'
)"

if [[ "$N_SNAP_EDIT_HTTP" != "200" ]]; then
  cat "$LOG_DIR/n-snap-edit.json"
  fail "Address mutation for snapshot check failed. HTTP $N_SNAP_EDIT_HTTP"
fi

curl -sS -o "$LOG_DIR/n-snap-after.json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$API_URL$API_PREFIX/orders/$N_SELF_ORDER_ID"

N_SNAP_AFTER="$(
  python3 - "$LOG_DIR/n-snap-after.json" <<'PYJSON'
import json, sys

order = json.load(open(sys.argv[1], encoding="utf-8"))
address = order.get("deliveryAddress") or {}

print("{}|{}|{}".format(address.get("city"), address.get("lat"), address.get("lng")))
PYJSON
)"

if [[ "$N_SNAP_AFTER" != "$N_SNAP_BEFORE" ]]; then
  cat "$LOG_DIR/n-snap-after.json"
  fail "Order destination snapshot changed after the address edit (before: $N_SNAP_BEFORE, after: $N_SNAP_AFTER)."
fi

N_SNAP_RESTORE_HTTP="$(
  curl -sS -o "$LOG_DIR/n-snap-restore.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/addresses/$ADDRESS_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"city":"Giyani","lat":-23.9,"lng":29.46}'
)"

if [[ "$N_SNAP_RESTORE_HTTP" != "200" ]]; then
  cat "$LOG_DIR/n-snap-restore.json"
  fail "Address restore after snapshot check failed. HTTP $N_SNAP_RESTORE_HTTP"
fi

echo "✓ Order snapshot immutable across address edit + restore ($N_SNAP_BEFORE)"

echo
echo "[N9/9] Supplier self-delivery evidence + state-machine isolation..."

N_SELF_CP_HTTP="$(
  curl -sS -o "$LOG_DIR/n-self-cp.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/deliveries/$N_SELF_DELIVERY_ID/checkpoints" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"PICKED_UP","lat":-23.8802,"lng":29.4502,"accuracyM":9,"note":"loaded the bakkie"}'
)"

if [[ "$N_SELF_CP_HTTP" != "201" ]]; then
  cat "$LOG_DIR/n-self-cp.json"
  fail "Self-delivery checkpoint write failed. HTTP $N_SELF_CP_HTTP"
fi

python3 - "$LOG_DIR/n-self-cp.json" <<'PYJSON'
import json, sys

cp = json.load(open(sys.argv[1], encoding="utf-8"))
flags = cp.get("flags", [])

if cp.get("actorRole") != "SUPPLIER":
    raise SystemExit("ERROR: self-delivery checkpoint actorRole must be SUPPLIER: {}".format(cp))
if "NO_PHOTO" not in flags:
    raise SystemExit("ERROR: required self-delivery pickup must flag NO_PHOTO: {}".format(flags))

print("✓ Supplier self-delivery checkpoint stored (actorRole SUPPLIER)")
PYJSON

N_SELF_STATE="$(
  curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$API_URL$API_PREFIX/orders/$N_SELF_ORDER_ID"
)"

if ! echo "$N_SELF_STATE" | grep -q '"status"[[:space:]]*:[[:space:]]*"READY_FOR_DELIVERY"'; then
  echo "$N_SELF_STATE"
  fail "A checkpoint moved the order state — the ledger must never drive the machine."
fi

echo "✓ Order still READY_FOR_DELIVERY after a pickup checkpoint"

N_SELF_LOCKOUT_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/deliveries/$N_DELIVERY_ID/checkpoints" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"type":"DELIVERED","lat":-23.9,"lng":29.46}'
)"

if [[ "$N_SELF_LOCKOUT_HTTP" != "404" ]]; then
  fail "Supplier writing checkpoints on a transporter-owned delivery must 404. HTTP $N_SELF_LOCKOUT_HTTP"
fi

echo "✓ Supplier locked out of transporter-owned ledgers (404)"

echo
echo "✓ CHECKPOINT LEDGER FLOW ACCEPTANCE PASSED"

echo
echo "MEDIA FOUNDATION FLOW (CP16a)"
echo "========================================"

# CP16a: direct signed browser → Cloudinary uploads. The API only signs,
# derives and cleans up — no bytes transit it. Without CLOUDINARY_* env the
# signature endpoint answers 503 and everything else (URL validation, derived
# public_id, logo fields) still works, which is the local/CI path.

echo
echo "[O1/8] Signature endpoint guards..."

O_SIG_ANON_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/media/signature" \
    -H "Content-Type: application/json" \
    -d '{"kind":"product"}'
)"

if [[ "$O_SIG_ANON_HTTP" != "401" ]]; then
  fail "Anonymous upload signing must 401. HTTP $O_SIG_ANON_HTTP"
fi

O_SIG_BUYER_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/media/signature" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"kind":"product"}'
)"

if [[ "$O_SIG_BUYER_HTTP" != "403" ]]; then
  fail "Buyer upload signing must 403 (nothing to upload). HTTP $O_SIG_BUYER_HTTP"
fi

echo "✓ Signature endpoint: anon 401, buyer 403"

echo
echo "[O2/8] Supplier signature (configured or graceful 503)..."

O_SIG_HTTP="$(
  curl -sS -o "$LOG_DIR/o-signature.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/media/signature" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"kind":"product"}'
)"

# 201 is Nest's default for POST and is what the endpoint has always returned
# when configured (the web client checks response.ok, so any 2xx works).
if [[ "$O_SIG_HTTP" == "200" || "$O_SIG_HTTP" == "201" ]]; then
  if ! python3 - "$LOG_DIR/o-signature.json" <<'PYJSON'
import json, sys
sig = json.load(open(sys.argv[1], encoding="utf-8"))
assert sig.get("cloudName"), "missing cloudName"
assert sig.get("apiKey"), "missing apiKey"
assert str(sig.get("uploadUrl", "")).startswith("https://api.cloudinary.com/"), sig.get("uploadUrl")
assert isinstance(sig.get("timestamp"), int), "timestamp must be an int"
assert sig.get("signature"), "missing signature"
assert str(sig.get("publicId", "")).startswith("bonagri/product/"), sig.get("publicId")
PYJSON
  then
    cat "$LOG_DIR/o-signature.json"
    fail "Upload signature payload was missing required fields."
  fi
elif [[ "$O_SIG_HTTP" == "503" ]]; then
  if ! grep -q "Media storage not configured" "$LOG_DIR/o-signature.json"; then
    cat "$LOG_DIR/o-signature.json"
    fail "503 signature response must say media storage is not configured."
  fi
else
  cat "$LOG_DIR/o-signature.json"
  fail "Upload signature must answer 200/201 (configured) or 503 (unset). HTTP $O_SIG_HTTP"
fi

echo "✓ Signature flow: 200 with full payload, or graceful 503"

echo
echo "[O3/8] Unknown upload kind rejected..."

O_KIND_HTTP="$(
  curl -sS -o "$LOG_DIR/o-kind.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/media/signature" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"kind":"delivery_photo"}'
)"

if [[ "$O_KIND_HTTP" != "400" ]]; then
  cat "$LOG_DIR/o-kind.json"
  fail "Unknown upload kind must 400 (DTO whitelist). HTTP $O_KIND_HTTP"
fi

echo "✓ Unknown kind rejected (400)"

echo
echo "[O4/8] Product image URL validation + derived public_id..."

O_PRODUCT_ID="$(
  curl -sS -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    "$API_URL$API_PREFIX/supplier/products" \
  | python3 -c 'import json,sys; items=json.load(sys.stdin); print(items[0]["id"] if items else "")'
)"

if [[ -z "$O_PRODUCT_ID" ]]; then
  fail "No supplier product available for the media round-trip."
fi

O_HTTP_URL_HTTP="$(
  curl -sS -o "$LOG_DIR/o-product-http.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/products/$O_PRODUCT_ID" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl":"http://cdn.examplefarm.co.za/insecure.jpg"}'
)"

if [[ "$O_HTTP_URL_HTTP" != "400" ]]; then
  cat "$LOG_DIR/o-product-http.json"
  fail "Insecure image URL must 400. HTTP $O_HTTP_URL_HTTP"
fi

O_SET_HTTP="$(
  curl -sS -o "$LOG_DIR/o-product-set.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/products/$O_PRODUCT_ID" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl":"https://res.cloudinary.com/bonagri-smoke/image/upload/c_fill,w_800/v1760000000/bonagri/product/smoke-img.jpg"}'
)"

if [[ "$O_SET_HTTP" != "200" ]]; then
  cat "$LOG_DIR/o-product-set.json"
  fail "Cloudinary image URL update failed. HTTP $O_SET_HTTP"
fi

if ! grep -q '"imagePublicId"[[:space:]]*:[[:space:]]*"bonagri/product/smoke-img"' "$LOG_DIR/o-product-set.json"; then
  cat "$LOG_DIR/o-product-set.json"
  fail "Managed Cloudinary URL did not store the derived public_id."
fi

echo "✓ http:// rejected (400); Cloudinary URL stores derived public_id"

echo
echo "[O5/8] External URLs store no public_id..."

O_EXT_HTTP="$(
  curl -sS -o "$LOG_DIR/o-product-ext.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/products/$O_PRODUCT_ID" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl":"https://cdn.examplefarm.co.za/tomatoes.jpg"}'
)"

if [[ "$O_EXT_HTTP" != "200" ]] || ! grep -q '"imagePublicId"[[:space:]]*:[[:space:]]*null' "$LOG_DIR/o-product-ext.json"; then
  cat "$LOG_DIR/o-product-ext.json"
  fail "External image URL must store imagePublicId null. HTTP $O_EXT_HTTP"
fi

# Shared-account safety: a Cloudinary URL from OUR cloud but a foreign folder
# must never be derived — a replace/clear would destroy an asset we don't own.
O_FOREIGN_HTTP="$(
  curl -sS -o "$LOG_DIR/o-product-foreign.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/products/$O_PRODUCT_ID" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl":"https://res.cloudinary.com/bonagri-smoke/image/upload/v1760000001/other-app/hero.jpg"}'
)"

if [[ "$O_FOREIGN_HTTP" != "200" ]] || ! grep -q '"imagePublicId"[[:space:]]*:[[:space:]]*null' "$LOG_DIR/o-product-foreign.json"; then
  cat "$LOG_DIR/o-product-foreign.json"
  fail "Foreign-folder Cloudinary URL must store imagePublicId null. HTTP $O_FOREIGN_HTTP"
fi

echo "✓ External + foreign-folder URLs accepted, no managed public_id"

echo
echo "[O6/8] Clearing the product image..."

O_CLEAR_HTTP="$(
  curl -sS -o "$LOG_DIR/o-product-clear.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/products/$O_PRODUCT_ID" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl":null}'
)"

if [[ "$O_CLEAR_HTTP" != "200" ]] || ! grep -q '"imageUrl"[[:space:]]*:[[:space:]]*null' "$LOG_DIR/o-product-clear.json" || ! grep -q '"imagePublicId"[[:space:]]*:[[:space:]]*null' "$LOG_DIR/o-product-clear.json"; then
  cat "$LOG_DIR/o-product-clear.json"
  fail "Clearing the image must wipe imageUrl + imagePublicId. HTTP $O_CLEAR_HTTP"
fi

echo "✓ imageUrl null clears URL + public_id"

echo
echo "[O7/8] Supplier logo endpoint guards + validation..."

O_LOGO_BUYER_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/supplier/profile" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"logoUrl":null}'
)"

if [[ "$O_LOGO_BUYER_HTTP" != "403" ]]; then
  fail "Buyer logo update must 403. HTTP $O_LOGO_BUYER_HTTP"
fi

O_LOGO_HTTP_URL_HTTP="$(
  curl -sS -o "$LOG_DIR/o-logo-http.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/supplier/profile" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"logoUrl":"http://cdn.examplefarm.co.za/logo.jpg"}'
)"

if [[ "$O_LOGO_HTTP_URL_HTTP" != "400" ]]; then
  cat "$LOG_DIR/o-logo-http.json"
  fail "Insecure logo URL must 400. HTTP $O_LOGO_HTTP_URL_HTTP"
fi

O_LOGO_SET_HTTP="$(
  curl -sS -o "$LOG_DIR/o-logo-set.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/supplier/profile" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"logoUrl":"https://res.cloudinary.com/bonagri-smoke/image/upload/v1760000000/bonagri/supplier_logo/smoke-logo.png"}'
)"

if [[ "$O_LOGO_SET_HTTP" != "200" ]] || ! grep -q '"logoPublicId"[[:space:]]*:[[:space:]]*"bonagri/supplier_logo/smoke-logo"' "$LOG_DIR/o-logo-set.json"; then
  cat "$LOG_DIR/o-logo-set.json"
  fail "Logo update must store the derived public_id. HTTP $O_LOGO_SET_HTTP"
fi

echo "✓ Logo endpoint: buyer 403, http 400, derived public_id on set"

echo
echo "[O8/8] Clearing the logo round-trips back to null..."

O_LOGO_CLEAR_HTTP="$(
  curl -sS -o "$LOG_DIR/o-logo-clear.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/supplier/profile" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"logoUrl":null}'
)"

if [[ "$O_LOGO_CLEAR_HTTP" != "200" ]] || ! grep -q '"logoUrl"[[:space:]]*:[[:space:]]*null' "$LOG_DIR/o-logo-clear.json" || ! grep -q '"logoPublicId"[[:space:]]*:[[:space:]]*null' "$LOG_DIR/o-logo-clear.json"; then
  cat "$LOG_DIR/o-logo-clear.json"
  fail "Clearing the logo must wipe logoUrl + logoPublicId. HTTP $O_LOGO_CLEAR_HTTP"
fi

echo "✓ Logo null clears URL + public_id"

echo
echo "✓ MEDIA FOUNDATION FLOW ACCEPTANCE PASSED"

echo
echo "PRODUCT REVIEWS & RATINGS FLOW (CP17)"
echo "========================================"

# This section runs before the admin flow on purpose: A2 re-roles the main
# smoke buyer to SUPPLIER, while review writes are buyer-only. The main buyer
# already has DELIVERED orders (supplier journey S + dealer journey D + CP12
# journey K), which is what makes them eligible to review.
# The flow is idempotent: repeat runs hit the 409 duplicate branch instead of
# failing.

echo "[R1/6] Public review reads + anonymous guards..."

R_LIST_HTTP="$(
  curl -sS -o "$LOG_DIR/r-reviews.json" -w "%{http_code}" \
    "$API_URL$API_PREFIX/products/$PRODUCT_ID/reviews"
)"

if [[ "$R_LIST_HTTP" != "200" ]]; then
  cat "$LOG_DIR/r-reviews.json"
  fail "Public review list failed. HTTP $R_LIST_HTTP"
fi

python3 - "$LOG_DIR/r-reviews.json" "$PRODUCT_ID" <<'PYJSON'
import json
import sys

with open(sys.argv[1]) as f:
    data = json.load(f)

if data.get("productId") != sys.argv[2]:
    raise SystemExit("ERROR: review payload is scoped to the wrong product")

if not isinstance(data.get("items"), list):
    raise SystemExit("ERROR: review payload is missing the items list")

if data.get("count") != len(data["items"]):
    raise SystemExit("ERROR: count does not match the returned items")

print("✓ Public review list: summary + {} review(s)".format(len(data["items"])))
PYJSON

R_UNKNOWN_ID="11111111-2222-4333-8444-555555555555"
R_UNKNOWN_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    "$API_URL$API_PREFIX/products/$R_UNKNOWN_ID/reviews"
)"

if [[ "$R_UNKNOWN_HTTP" != "404" ]]; then
  fail "Unknown product review read should be 404, got HTTP $R_UNKNOWN_HTTP"
fi
echo "✓ Unknown product -> 404"

R_ANON_POST_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d '{"rating":5}' \
    "$API_URL$API_PREFIX/products/$PRODUCT_ID/reviews"
)"

if [[ "$R_ANON_POST_HTTP" != "401" ]]; then
  fail "Anonymous review write should be 401, got HTTP $R_ANON_POST_HTTP"
fi

R_ANON_MINE_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    "$API_URL$API_PREFIX/products/$PRODUCT_ID/reviews/mine"
)"

if [[ "$R_ANON_MINE_HTTP" != "401" ]]; then
  fail "Anonymous /reviews/mine should be 401, got HTTP $R_ANON_MINE_HTTP"
fi
echo "✓ Anonymous write + /mine -> 401"

echo
echo "[R2/6] Role and delivered-order eligibility guards..."

R_SUP_POST_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $SUPPLIER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"rating":5}' \
    "$API_URL$API_PREFIX/products/$PRODUCT_ID/reviews"
)"

if [[ "$R_SUP_POST_HTTP" != "403" ]]; then
  fail "Supplier review write should be 403 (buyer-only), got HTTP $R_SUP_POST_HTTP"
fi
echo "✓ Supplier write -> 403"

R_BAD_RATING_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"rating":6}' \
    "$API_URL$API_PREFIX/products/$PRODUCT_ID/reviews"
)"

if [[ "$R_BAD_RATING_HTTP" != "400" ]]; then
  fail "Out-of-range rating should be 400, got HTTP $R_BAD_RATING_HTTP"
fi
echo "✓ rating=6 rejected with 400"

# Pick an ACTIVE product this buyer has NEVER received (their delivered
# orders are computed from the API, so new journeys cannot break the check).
curl -sS -o "$LOG_DIR/r-orders.json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$API_URL$API_PREFIX/orders"
curl -sS -o "$LOG_DIR/r-products.json" \
  "$API_URL$API_PREFIX/products"

R_INELIGIBLE_ID="$(
  python3 - "$LOG_DIR/r-orders.json" "$LOG_DIR/r-products.json" <<'PYJSON'
import json
import sys

with open(sys.argv[1]) as f:
    orders = json.load(f)
with open(sys.argv[2]) as f:
    products = json.load(f)

delivered_ids = set()
for order in orders:
    if order.get("status") != "DELIVERED":
        continue
    for item in order.get("items", []):
        product_id = (item.get("product") or {}).get("id")
        if product_id:
            delivered_ids.add(product_id)

for product in products:
    if product.get("status") != "ACTIVE":
        continue
    if product.get("id") in delivered_ids:
        continue
    print(product["id"])
    break
else:
    raise SystemExit("ERROR: no eligible-free ACTIVE product for the 403 check")
PYJSON
)"

R_INELIGIBLE_HTTP="$(
  curl -sS -o "$LOG_DIR/r-ineligible.json" -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"rating":5,"comment":"Should be refused"}' \
    "$API_URL$API_PREFIX/products/$R_INELIGIBLE_ID/reviews"
)"

if [[ "$R_INELIGIBLE_HTTP" != "403" ]]; then
  cat "$LOG_DIR/r-ineligible.json"
  fail "Review without a delivered order should be 403, got HTTP $R_INELIGIBLE_HTTP"
fi
echo "✓ No delivered order for that product -> 403"

echo
echo "[R3/6] Eligible buyer posts a review..."

R_CREATE_BODY="{\"rating\":4,\"comment\":\"Fresh and well packed - smoke test\"}"
R_CREATE_HTTP="$(
  curl -sS -o "$LOG_DIR/r-create.json" -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$R_CREATE_BODY" \
    "$API_URL$API_PREFIX/products/$PRODUCT_ID/reviews"
)"

case "$R_CREATE_HTTP" in
  200 | 201)
    echo "✓ Review created (HTTP $R_CREATE_HTTP)"
    ;;
  409)
    # Repeat run: this buyer already reviewed the pinned product.
    echo "✓ Review already exists from a previous run (HTTP 409)"
    ;;
  *)
    cat "$LOG_DIR/r-create.json"
    fail "Review creation failed. HTTP $R_CREATE_HTTP"
    ;;
esac

echo
echo "[R4/6] One review per buyer per product..."

R_DUP_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"rating":1}' \
    "$API_URL$API_PREFIX/products/$PRODUCT_ID/reviews"
)"

if [[ "$R_DUP_HTTP" != "409" ]]; then
  fail "Duplicate review should be 409, got HTTP $R_DUP_HTTP"
fi
echo "✓ Second review rejected with 409"

echo
echo "[R5/6] The rating summary lands in the catalog payloads..."

curl -sS -o "$LOG_DIR/r-catalog.json" "$API_URL$API_PREFIX/products"
curl -sS -o "$LOG_DIR/r-detail.json" "$API_URL$API_PREFIX/products/$PRODUCT_ID"
curl -sS -o "$LOG_DIR/r-mine.json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$API_URL$API_PREFIX/products/$PRODUCT_ID/reviews/mine"

python3 - "$LOG_DIR/r-catalog.json" "$LOG_DIR/r-detail.json" \
  "$LOG_DIR/r-mine.json" "$PRODUCT_ID" <<'PYJSON'
import json
import sys

with open(sys.argv[1]) as f:
    catalog = json.load(f)
with open(sys.argv[2]) as f:
    detail = json.load(f)
with open(sys.argv[3]) as f:
    mine = json.load(f)

product_id = sys.argv[4]
listed = next((p for p in catalog if p.get("id") == product_id), None)

if listed is None:
    raise SystemExit("ERROR: reviewed product missing from GET /products")

for label, product in (("list", listed), ("detail", detail)):
    average = product.get("ratingAverage")
    count = product.get("ratingCount")
    if not isinstance(count, int) or count < 1:
        raise SystemExit(
            "ERROR: {} payload has no ratingCount ({!r})".format(label, count)
        )
    if not isinstance(average, (int, float)) or average < 1:
        raise SystemExit(
            "ERROR: {} payload has no ratingAverage ({!r})".format(label, average)
        )
    print(
        "✓ {} payload: {}★ average from {} review(s)".format(
            label, average, count
        )
    )

if mine.get("canReview"):
    raise SystemExit("ERROR: buyer must not be able to review twice")
if not mine.get("review"):
    raise SystemExit("ERROR: /reviews/mine did not return the buyer's review")
print("✓ /reviews/mine returns the stored review, canReview=False")
PYJSON

echo
echo "[R6/6] The product screen route serves..."

R_ROUTE_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" "$WEB_URL/products/$PRODUCT_ID"
)"

if [[ "$R_ROUTE_HTTP" != "200" ]]; then
  fail "Web route /products/<id> should return 200, got HTTP $R_ROUTE_HTTP"
fi
echo "✓ Web route /products/<id> -> 200"

echo
echo "✓ PRODUCT REVIEWS & RATINGS FLOW ACCEPTANCE PASSED"

echo
echo "ADMIN MANAGEMENT FLOW"
echo "========================================"

ADMIN_E2E_EMAIL="${ADMIN_E2E_EMAIL:-}"
ADMIN_E2E_PASSWORD="${ADMIN_E2E_PASSWORD:-}"

if [ -z "$ADMIN_E2E_PASSWORD" ] && [ -f "$API/.env" ]; then
  ADMIN_E2E_EMAIL="${ADMIN_E2E_EMAIL:-$(sed -n 's/^SEED_ADMIN_EMAIL=//p' "$API/.env" | tail -1)}"
  ADMIN_E2E_PASSWORD="$(sed -n 's/^SEED_ADMIN_PASSWORD=//p' "$API/.env" | tail -1 | tr -d "\"'" | tr -d '\r')"
fi

if [ -z "$ADMIN_E2E_EMAIL" ]; then
  ADMIN_E2E_EMAIL="admin@bonagri.co.za"
fi

if [ -z "$ADMIN_E2E_PASSWORD" ]; then
  echo "⚠ Admin section SKIPPED: no SEED_ADMIN_PASSWORD in api/.env and no ADMIN_E2E_PASSWORD env var."
else

echo
echo "[A1/3] Admin login + platform stats..."

# HP2: two-step sign-in (password → pre-auth → TOTP) via the shared helper.
ADMIN_TOKEN="$(admin_login "$ADMIN_E2E_EMAIL" "$ADMIN_E2E_PASSWORD")"

if [ -z "$ADMIN_TOKEN" ]; then
  fail "Admin login returned no access token"
fi

echo "✓ Admin login succeeded (two-step 2FA)"

request GET "$API_URL$API_PREFIX/admin/stats" "" "$ADMIN_TOKEN" > "$LOG_DIR/admin-stats.json"

python3 - "$LOG_DIR/admin-stats.json" <<'PYJSON'
import json, sys

stats = json.load(open(sys.argv[1], encoding="utf-8"))

if stats.get("users", {}).get("total", 0) < 3:
    raise SystemExit("ERROR: expected at least 3 users in platform stats")

if stats.get("products", {}).get("total", 0) < 1:
    raise SystemExit("ERROR: expected at least 1 product in platform stats")

if "transporters" not in stats.get("users", {}):
    raise SystemExit("ERROR: stats users breakdown is missing 'transporters'")

print("✓ Platform stats: {} users, {} products, {} orders".format(
    stats["users"]["total"], stats["products"]["total"], stats["orders"]["total"]))
PYJSON

request GET "$API_URL$API_PREFIX/admin/users?role=TRANSPORTER" "" "$ADMIN_TOKEN" > "$LOG_DIR/admin-users-transporter.json"

python3 - "$LOG_DIR/admin-users-transporter.json" <<'PYJSON'
import json, sys

users = json.load(open(sys.argv[1], encoding="utf-8"))

if not isinstance(users, list):
    raise SystemExit("ERROR: /admin/users?role=TRANSPORTER must return a list, got: {}".format(str(users)[:200]))

for u in users:
    if u.get("role") != "TRANSPORTER":
        raise SystemExit("ERROR: role filter returned a non-TRANSPORTER user: {}".format(u.get("email")))

print("✓ /admin/users?role=TRANSPORTER -> {} account(s)".format(len(users)))
PYJSON

echo
echo "[A2/3] Promote buyer -> supplier, suspend -> reactivate..."

PROMOTE_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-promote.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/users/$USER_ID/promote-supplier" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d '{"businessName":"Smoke Admin Traders","city":"Polokwane"}'
)"

if [[ "$PROMOTE_HTTP" != "201" ]]; then
  cat "$LOG_DIR/admin-promote.json"
  fail "Promote-to-supplier failed. HTTP $PROMOTE_HTTP"
fi

python3 - "$LOG_DIR/admin-promote.json" <<'PYJSON'
import json, sys

user = json.load(open(sys.argv[1], encoding="utf-8"))

if user.get("role") != "SUPPLIER" or not user.get("supplierProfile"):
    raise SystemExit("ERROR: promotion did not produce SUPPLIER role with a profile")

print("✓ Promoted to SUPPLIER with profile {}".format(user["supplierProfile"]["id"]))
PYJSON

PROMOTE_AGAIN_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-promote-again.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/users/$USER_ID/promote-supplier" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d '{"businessName":"Smoke Admin Traders Again"}'
)"

if [[ "$PROMOTE_AGAIN_HTTP" != "409" ]]; then
  cat "$LOG_DIR/admin-promote-again.json"
  fail "Second promotion should conflict (profile created exactly once). HTTP $PROMOTE_AGAIN_HTTP"
fi

echo "✓ Second promotion rejected with 409 (profile exists exactly once)"

PROMOTED_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-promoted-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"
)"

if [[ "$PROMOTED_LOGIN_HTTP" != "201" ]]; then
  cat "$LOG_DIR/admin-promoted-login.json"
  fail "Promoted user login failed. HTTP $PROMOTED_LOGIN_HTTP"
fi

PROMOTED_TOKEN="$(
  python3 -c '
import json,sys
with open(sys.argv[1]) as f:
    data=json.load(f)
print(data.get("accessToken",""))
' "$LOG_DIR/admin-promoted-login.json"
)"

python3 - "$LOG_DIR/admin-promoted-login.json" <<'PYJSON'
import json, sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
role = data.get("user", {}).get("role")

if role != "SUPPLIER":
    raise SystemExit("ERROR: expected role SUPPLIER after re-login, got {}".format(role))

print("✓ Promoted user re-logs-in as SUPPLIER (lands on supplier hub role)")
PYJSON

SUPPLIER_HUB_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-supplier-hub.json" -w "%{http_code}" \
    -X GET "$API_URL$API_PREFIX/orders/supplier" \
    -H "Authorization: Bearer $PROMOTED_TOKEN"
)"

if [[ "$SUPPLIER_HUB_HTTP" != "200" ]]; then
  cat "$LOG_DIR/admin-supplier-hub.json"
  fail "Promoted user cannot load supplier hub data. HTTP $SUPPLIER_HUB_HTTP"
fi

echo "✓ Promoted user loads supplier hub data (GET /orders/supplier -> 200)"

SUSPEND_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-suspend.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/admin/users/$USER_ID/status" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d '{"status":"SUSPENDED"}'
)"

if [[ "$SUSPEND_HTTP" != "200" ]]; then
  cat "$LOG_DIR/admin-suspend.json"
  fail "Suspend failed. HTTP $SUSPEND_HTTP"
fi

TOKEN_AFTER_SUSPEND_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-token-rejected.json" -w "%{http_code}" \
    -X GET "$API_URL$API_PREFIX/auth/me" \
    -H "Authorization: Bearer $PROMOTED_TOKEN"
)"

if [[ "$TOKEN_AFTER_SUSPEND_HTTP" != "401" ]]; then
  cat "$LOG_DIR/admin-token-rejected.json"
  fail "Existing token still valid after suspension. HTTP $TOKEN_AFTER_SUSPEND_HTTP"
fi

echo "✓ Existing token rejected at the guard after suspension"

SUSPENDED_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-suspended-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"
)"

if [[ "$SUSPENDED_LOGIN_HTTP" != "401" ]]; then
  cat "$LOG_DIR/admin-suspended-login.json"
  fail "Suspended user could still log in. HTTP $SUSPENDED_LOGIN_HTTP"
fi

echo "✓ Login refused while suspended (401)"

REACTIVATE_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-reactivate.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/admin/users/$USER_ID/status" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d '{"status":"ACTIVE"}'
)"

if [[ "$REACTIVATE_HTTP" != "200" ]]; then
  cat "$LOG_DIR/admin-reactivate.json"
  fail "Reactivation failed. HTTP $REACTIVATE_HTTP"
fi

REACTIVATED_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-reactivated-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"
)"

if [[ "$REACTIVATED_LOGIN_HTTP" != "201" ]]; then
  cat "$LOG_DIR/admin-reactivated-login.json"
  fail "Reactivated user cannot log in. HTTP $REACTIVATED_LOGIN_HTTP"
fi

echo "✓ Reactivated user logs in again (201)"

echo
echo "[A3/3] Category create/rename + supplier verification toggle..."

ADMIN_CAT_TS="$(date +%s)"
ADMIN_CAT_SLUG="smoke-admin-category-$ADMIN_CAT_TS"

CREATE_CAT_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-category.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/categories" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"Smoke Admin Category $ADMIN_CAT_TS\",\"slug\":\"$ADMIN_CAT_SLUG\"}"
)"

if [[ "$CREATE_CAT_HTTP" != "201" ]]; then
  cat "$LOG_DIR/admin-category.json"
  fail "Category creation failed. HTTP $CREATE_CAT_HTTP"
fi

ADMIN_CATEGORY_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/admin-category.json"
)"

if [ -z "$ADMIN_CATEGORY_ID" ]; then
  fail "Category creation returned no id"
fi

echo "✓ Category created"

request GET "$API_URL$API_PREFIX/categories" "" > "$LOG_DIR/admin-categories-public.json"

python3 - "$LOG_DIR/admin-categories-public.json" "$ADMIN_CAT_SLUG" <<'PYJSON'
import json, sys

categories = json.load(open(sys.argv[1], encoding="utf-8"))
slug = sys.argv[2]

if not any(c.get("slug") == slug for c in categories):
    raise SystemExit("ERROR: new category not visible on the public marketplace list")

print("✓ New category visible on the public marketplace (/{}/)".format(slug))
PYJSON

RENAME_CAT_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-category-renamed.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/admin/categories/$ADMIN_CATEGORY_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"Smoke Admin Category Renamed $ADMIN_CAT_TS\"}"
)"

if [[ "$RENAME_CAT_HTTP" != "200" ]]; then
  cat "$LOG_DIR/admin-category-renamed.json"
  fail "Category rename failed. HTTP $RENAME_CAT_HTTP"
fi

request GET "$API_URL$API_PREFIX/categories" "" > "$LOG_DIR/admin-categories-renamed.json"

python3 - "$LOG_DIR/admin-categories-renamed.json" "$ADMIN_CAT_SLUG" "Smoke Admin Category Renamed $ADMIN_CAT_TS" <<'PYJSON'
import json, sys

categories = json.load(open(sys.argv[1], encoding="utf-8"))
slug = sys.argv[2]
expected_name = sys.argv[3]

match = next((c for c in categories if c.get("slug") == slug), None)

if match is None or match.get("name") != expected_name:
    raise SystemExit("ERROR: category rename not visible on the public marketplace list")

print("✓ Category rename visible publicly")
PYJSON

DUP_CAT_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-category-dup.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/categories" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"Smoke Admin Category Duplicate\",\"slug\":\"$ADMIN_CAT_SLUG\"}"
)"

if [[ "$DUP_CAT_HTTP" != "409" ]]; then
  cat "$LOG_DIR/admin-category-dup.json"
  fail "Duplicate category slug should conflict. HTTP $DUP_CAT_HTTP"
fi

echo "✓ Duplicate category slug handled with 409"

request GET "$API_URL$API_PREFIX/products" "" > "$LOG_DIR/admin-products.json"

SUPPLIER_PROFILE_ID="$(
  python3 -c '
import json,sys
products = json.load(open(sys.argv[1], encoding="utf-8"))
if not products:
    raise SystemExit("ERROR: no products in the marketplace; run the seed first")
print(products[0]["supplier"]["id"])
' "$LOG_DIR/admin-products.json"
)"

CURRENT_VERIFIED="$(
  python3 -c '
import json,sys
products = json.load(open(sys.argv[1], encoding="utf-8"))
print(str(products[0]["supplier"]["verified"]).lower())
' "$LOG_DIR/admin-products.json"
)"

if [ "$CURRENT_VERIFIED" = "true" ]; then
  NEXT_VERIFIED="false"
else
  NEXT_VERIFIED="true"
fi

VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-verify.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/admin/suppliers/$SUPPLIER_PROFILE_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d "{\"verified\":$NEXT_VERIFIED}"
)"

if [[ "$VERIFY_HTTP" != "200" ]]; then
  cat "$LOG_DIR/admin-verify.json"
  fail "Verification toggle failed. HTTP $VERIFY_HTTP"
fi

request GET "$API_URL$API_PREFIX/products" "" > "$LOG_DIR/admin-products-verified.json"

python3 - "$LOG_DIR/admin-products-verified.json" "$SUPPLIER_PROFILE_ID" "$NEXT_VERIFIED" <<'PYJSON'
import json, sys

products = json.load(open(sys.argv[1], encoding="utf-8"))
supplier_id = sys.argv[2]
expected = sys.argv[3] == "true"

match = next((p for p in products if p.get("supplier", {}).get("id") == supplier_id), None)

if match is None:
    raise SystemExit("ERROR: supplier's product missing from the marketplace")

if match["supplier"]["verified"] is not expected:
    raise SystemExit(
        "ERROR: public verified flag did not update (expected {}, got {})".format(
            expected, match["supplier"]["verified"]
        )
    )

print("✓ Verification toggle readable publicly (supplier.verified={})".format(expected))
PYJSON

RESTORE_VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-verify-restore.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/admin/suppliers/$SUPPLIER_PROFILE_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d "{\"verified\":$CURRENT_VERIFIED}"
)"

if [[ "$RESTORE_VERIFY_HTTP" != "200" ]]; then
  cat "$LOG_DIR/admin-verify-restore.json"
  fail "Verification restore failed. HTTP $RESTORE_VERIFY_HTTP"
fi

echo "✓ Original verification state restored"

fi

echo
echo "✓ ADMIN MANAGEMENT FLOW ACCEPTANCE PASSED"

echo
echo "MARKETPLACE PROMOTIONS FLOW"
echo "========================================"

if [ -z "${ADMIN_TOKEN:-}" ]; then
  echo "⚠ Promotions section SKIPPED: admin login did not run."
else

echo
echo "[P1/4] Campaign management is admin-only..."

PROMO_ANON_HTTP="$(
  curl -sS -o "$LOG_DIR/promo-anon-admin.json" -w "%{http_code}" \
    "$API_URL$API_PREFIX/admin/promotions"
)"

if [[ "$PROMO_ANON_HTTP" != "401" ]]; then
  cat "$LOG_DIR/promo-anon-admin.json"
  fail "Anonymous campaign admin request returned HTTP $PROMO_ANON_HTTP, expected 401"
fi

echo "✓ Anonymous campaign admin request rejected (401)"

PROMO_SUPPLIER_HTTP="$(
  curl -sS -o "$LOG_DIR/promo-supplier-admin.json" -w "%{http_code}" \
    "$API_URL$API_PREFIX/admin/promotions" \
    -H "Authorization: Bearer $SUPPLIER_TOKEN"
)"

if [[ "$PROMO_SUPPLIER_HTTP" != "403" ]]; then
  cat "$LOG_DIR/promo-supplier-admin.json"
  fail "Non-admin campaign admin request returned HTTP $PROMO_SUPPLIER_HTTP, expected 403"
fi

echo "✓ Non-admin campaign admin request rejected (403)"

echo
echo "[P2/4] Admin publishes a campaign that resolves real catalog data..."

PROMO_TS="$(date +%s)"
PROMO_NAME="Smoke Promotions $PROMO_TS"

# Any product works for the campaign; it must merely still have sellable
# stock, or the public resolver correctly drops the card.
PROMO_PRODUCT_ID="$(
  request GET "$API_URL$API_PREFIX/products" "" | python3 -c '
import json, sys
products = json.load(sys.stdin)
available = [
    product
    for product in products
    if product.get("inventory")
    and product["inventory"].get("quantity", 0) - product["inventory"].get("reservedQuantity", 0) > 0
]
if not available:
    raise SystemExit("ERROR: no product with available stock for the promotions flow")
print(available[0]["id"])
'
)"

PROMO_PAYLOAD="$(
  python3 -c '
import json, sys
print(json.dumps({
    "name": sys.argv[1],
    "headline": "Smoke test harvest deal",
    "description": "Created by the runtime smoke test.",
    "type": "FEATURED_PRODUCTS",
    "status": "ACTIVE",
    "layout": "BANNER",
    "placement": "HOME_TOP",
    "priority": 1000,
    "ctaText": "View offer",
    "isSponsored": True,
    "destinationType": "PRODUCT",
    "destinationId": sys.argv[2],
    "products": [{"productId": sys.argv[2]}],
}))
' "$PROMO_NAME" "$PROMO_PRODUCT_ID"
)"

CREATE_PROMO_HTTP="$(
  curl -sS -o "$LOG_DIR/promo-create.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/promotions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d "$PROMO_PAYLOAD"
)"

if [[ "$CREATE_PROMO_HTTP" != "201" ]]; then
  cat "$LOG_DIR/promo-create.json"
  fail "Campaign creation failed. HTTP $CREATE_PROMO_HTTP"
fi

PROMO_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/promo-create.json"
)"

if [ -z "$PROMO_ID" ]; then
  fail "Campaign creation returned no id"
fi

echo "✓ Campaign $PROMO_ID published (ACTIVE)"

request GET "$API_URL$API_PREFIX/promotions?placement=HOME_TOP&limit=10" "" > "$LOG_DIR/promo-public.json"

python3 - "$LOG_DIR/promo-public.json" "$PROMO_ID" "$PROMO_PRODUCT_ID" <<'PYJSON'
import json, sys

campaigns = json.load(open(sys.argv[1], encoding="utf-8"))
campaign_id, product_id = sys.argv[2], sys.argv[3]

if not isinstance(campaigns, list):
    raise SystemExit("ERROR: public promotions must return a list")

match = next((campaign for campaign in campaigns if campaign.get("id") == campaign_id), None)

if match is None:
    raise SystemExit("ERROR: active campaign missing from the public feed")

if not any(product.get("id") == product_id for product in match.get("products", [])):
    raise SystemExit("ERROR: campaign did not resolve the real product")

for forbidden in ("status", "effectiveStatus", "impressions", "clicks", "createdAt", "updatedAt"):
    if forbidden in match:
        raise SystemExit("ERROR: public campaign exposes admin field {!r}".format(forbidden))

print("✓ Campaign visible publicly with real product data and no admin fields")
PYJSON

echo
echo "[P3/4] Drafts/scheduled stay private; analytics dedupe events..."

PROMO_DRAFT_PAYLOAD="$(
  python3 -c '
import json, sys
print(json.dumps({
    "name": sys.argv[1] + " draft",
    "headline": "Unpublished draft",
    "type": "FEATURED_PRODUCTS",
    "status": "DRAFT",
    "placement": "HOME_TOP",
    "priority": 999,
    "destinationType": "PRODUCT",
    "destinationId": sys.argv[2],
    "products": [{"productId": sys.argv[2]}],
}))
' "$PROMO_NAME" "$PROMO_PRODUCT_ID"
)"

CREATE_DRAFT_HTTP="$(
  curl -sS -o "$LOG_DIR/promo-draft.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/promotions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d "$PROMO_DRAFT_PAYLOAD"
)"

if [[ "$CREATE_DRAFT_HTTP" != "201" ]]; then
  cat "$LOG_DIR/promo-draft.json"
  fail "Draft campaign creation failed. HTTP $CREATE_DRAFT_HTTP"
fi

PROMO_DRAFT_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/promo-draft.json"
)"

PROMO_START_AT="$(
  python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)).isoformat().replace("+00:00", "Z"))'
)"

PROMO_SCHEDULED_PAYLOAD="$(
  python3 -c '
import json, sys
print(json.dumps({
    "name": sys.argv[1] + " scheduled",
    "headline": "Scheduled for later",
    "type": "FEATURED_PRODUCTS",
    "status": "SCHEDULED",
    "placement": "HOME_TOP",
    "priority": 998,
    "startAt": sys.argv[3],
    "destinationType": "PRODUCT",
    "destinationId": sys.argv[2],
    "products": [{"productId": sys.argv[2]}],
}))
' "$PROMO_NAME" "$PROMO_PRODUCT_ID" "$PROMO_START_AT"
)"

CREATE_SCHEDULED_HTTP="$(
  curl -sS -o "$LOG_DIR/promo-scheduled.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/promotions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d "$PROMO_SCHEDULED_PAYLOAD"
)"

if [[ "$CREATE_SCHEDULED_HTTP" != "201" ]]; then
  cat "$LOG_DIR/promo-scheduled.json"
  fail "Scheduled campaign creation failed. HTTP $CREATE_SCHEDULED_HTTP"
fi

PROMO_SCHEDULED_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/promo-scheduled.json"
)"

PROMO_PUBLIC_AFTER_DRAFTS="$(
  request GET "$API_URL$API_PREFIX/promotions?placement=HOME_TOP&limit=10" ""
)"

python3 - "$PROMO_PUBLIC_AFTER_DRAFTS" "$PROMO_DRAFT_ID" "$PROMO_SCHEDULED_ID" <<'PYJSON'
import json, sys

campaigns = json.loads(sys.argv[1])
hidden = {sys.argv[2], sys.argv[3]}

leaked = [campaign.get("id") for campaign in campaigns if campaign.get("id") in hidden]

if leaked:
    raise SystemExit("ERROR: draft/scheduled campaigns leaked publicly: {}".format(leaked))

print("✓ Draft and scheduled campaigns are not public")
PYJSON

PROMO_IMPRESSION_KEY="smoke-impression-$PROMO_TS"
PROMO_IMPRESSION_BODY="{\"events\":[{\"campaignId\":\"$PROMO_ID\",\"type\":\"IMPRESSION\",\"eventKey\":\"$PROMO_IMPRESSION_KEY\"}]}"

request POST "$API_URL$API_PREFIX/promotions/events" "$PROMO_IMPRESSION_BODY" > "$LOG_DIR/promo-event-first.json"
request POST "$API_URL$API_PREFIX/promotions/events" "$PROMO_IMPRESSION_BODY" > "$LOG_DIR/promo-event-duplicate.json"

python3 - "$LOG_DIR/promo-event-first.json" "$LOG_DIR/promo-event-duplicate.json" <<'PYJSON'
import json, sys

first = json.load(open(sys.argv[1], encoding="utf-8"))
duplicate = json.load(open(sys.argv[2], encoding="utf-8"))

if first.get("accepted") != 1:
    raise SystemExit("ERROR: first impression was not accepted")

if duplicate.get("accepted") != 0:
    raise SystemExit("ERROR: duplicate impression was counted twice")

print("✓ Impression recorded once; duplicate eventKey ignored")
PYJSON

PROMO_CLICK_BODY="{\"events\":[{\"campaignId\":\"$PROMO_ID\",\"type\":\"CLICK\",\"eventKey\":\"smoke-click-$PROMO_TS\"}]}"
request POST "$API_URL$API_PREFIX/promotions/events" "$PROMO_CLICK_BODY" > "$LOG_DIR/promo-event-click.json"

request GET "$API_URL$API_PREFIX/admin/promotions/$PROMO_ID" "" "$ADMIN_TOKEN" > "$LOG_DIR/promo-admin-detail.json"

python3 - "$LOG_DIR/promo-admin-detail.json" <<'PYJSON'
import json, sys

campaign = json.load(open(sys.argv[1], encoding="utf-8"))

if campaign.get("impressions") != 1 or campaign.get("clicks") != 1:
    raise SystemExit(
        "ERROR: campaign counters are wrong (impressions={}, clicks={})".format(
            campaign.get("impressions"), campaign.get("clicks")
        )
    )

print("✓ Admin counters: 1 impression, 1 click")
PYJSON

echo
echo "[P4/4] Pause, preview, resume and delete control public visibility..."

PROMO_PAUSE_HTTP="$(
  curl -sS -o "$LOG_DIR/promo-pause.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/promotions/$PROMO_ID/pause" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")"
)"

if [[ "$PROMO_PAUSE_HTTP" != "201" ]]; then
  cat "$LOG_DIR/promo-pause.json"
  fail "Pausing the campaign failed. HTTP $PROMO_PAUSE_HTTP"
fi

PROMO_PUBLIC_PAUSED="$(
  request GET "$API_URL$API_PREFIX/promotions?placement=HOME_TOP&limit=10" ""
)"

python3 - "$PROMO_PUBLIC_PAUSED" "$PROMO_ID" <<'PYJSON'
import json, sys

campaigns = json.loads(sys.argv[1])
campaign_id = sys.argv[2]

if any(campaign.get("id") == campaign_id for campaign in campaigns):
    raise SystemExit("ERROR: paused campaign is still public")

print("✓ Paused campaign hidden from the public feed")
PYJSON

PROMO_PREVIEW_HTTP="$(
  curl -sS -o "$LOG_DIR/promo-preview.json" -w "%{http_code}" \
    "$API_URL$API_PREFIX/admin/promotions/$PROMO_ID/preview" \
    -H "Authorization: Bearer $ADMIN_TOKEN"
)"

if [[ "$PROMO_PREVIEW_HTTP" != "200" ]]; then
  cat "$LOG_DIR/promo-preview.json"
  fail "Admin preview failed. HTTP $PROMO_PREVIEW_HTTP"
fi

PROMO_RESUME_HTTP="$(
  curl -sS -o "$LOG_DIR/promo-resume.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/promotions/$PROMO_ID/resume" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")"
)"

if [[ "$PROMO_RESUME_HTTP" != "201" ]]; then
  cat "$LOG_DIR/promo-resume.json"
  fail "Resuming the campaign failed. HTTP $PROMO_RESUME_HTTP"
fi

PROMO_PUBLIC_RESUMED="$(
  request GET "$API_URL$API_PREFIX/promotions?placement=HOME_TOP&limit=10" ""
)"

python3 - "$PROMO_PUBLIC_RESUMED" "$PROMO_ID" <<'PYJSON'
import json, sys

campaigns = json.loads(sys.argv[1])
campaign_id = sys.argv[2]

if not any(campaign.get("id") == campaign_id for campaign in campaigns):
    raise SystemExit("ERROR: resumed campaign is not public again")

print("✓ Resumed campaign public again")
PYJSON

PROMO_DELETE_HTTP="$(
  curl -sS -o "$LOG_DIR/promo-delete.json" -w "%{http_code}" \
    -X DELETE "$API_URL$API_PREFIX/admin/promotions/$PROMO_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")"
)"

if [[ "$PROMO_DELETE_HTTP" != "200" ]]; then
  cat "$LOG_DIR/promo-delete.json"
  fail "Deleting the campaign failed. HTTP $PROMO_DELETE_HTTP"
fi

PROMO_PUBLIC_DELETED="$(
  request GET "$API_URL$API_PREFIX/promotions?placement=HOME_TOP&limit=10" ""
)"

python3 - "$PROMO_PUBLIC_DELETED" "$PROMO_ID" <<'PYJSON'
import json, sys

campaigns = json.loads(sys.argv[1])
campaign_id = sys.argv[2]

if any(campaign.get("id") == campaign_id for campaign in campaigns):
    raise SystemExit("ERROR: deleted campaign is still public")

print("✓ Deleted campaign removed from the public feed")
PYJSON

for PROMO_CLEANUP_ID in "$PROMO_DRAFT_ID" "$PROMO_SCHEDULED_ID"; do
  PROMO_CLEANUP_HTTP="$(
    curl -sS -o /dev/null -w "%{http_code}" \
      -X DELETE "$API_URL$API_PREFIX/admin/promotions/$PROMO_CLEANUP_ID" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")"
  )"

  if [[ "$PROMO_CLEANUP_HTTP" != "200" ]]; then
    fail "Cleaning up campaign $PROMO_CLEANUP_ID failed. HTTP $PROMO_CLEANUP_HTTP"
  fi
done

echo "✓ Draft and scheduled campaigns cleaned up"

echo
echo "✓ MARKETPLACE PROMOTIONS FLOW ACCEPTANCE PASSED"

fi

echo
echo "LISTINGS SIGNALS FLOW"
echo "========================================"

# Real-signature checks for the three marketplace rails: trending ranking
# (unit-tested in Jest), personalized picks, and the NEAR_YOU card.
# Runs before section L on purpose — registering a fresh buyer here must not
# collide with the login-burst rate-limit assertions below.

echo
echo "[PICKS 1/4] Personalized picks require a signed-in account..."

PICKS_ANON_HTTP="$(
  curl -sS -o "$LOG_DIR/picks-anon.json" -w "%{http_code}" \
    "$API_URL$API_PREFIX/products/picks?take=12"
)"

if [[ "$PICKS_ANON_HTTP" != "401" ]]; then
  cat "$LOG_DIR/picks-anon.json"
  fail "Anonymous picks request returned HTTP $PICKS_ANON_HTTP, expected 401"
fi

echo "✓ Anonymous picks rejected (401)"

echo
echo "[PICKS 2/4] A fresh buyer with no order history gets no fake picks..."

rm -f "$CAPTURE_FILE"
PICKS_EMAIL="picks_buyer_$(date +%s)@bonagri.local"

PICKS_REGISTER_HTTP="$(
  curl -sS -o "$LOG_DIR/picks-register.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$PICKS_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"firstName\":\"Picks\",\"lastName\":\"Buyer\"}"
)"

if [[ "$PICKS_REGISTER_HTTP" != "201" && "$PICKS_REGISTER_HTTP" != "200" ]]; then
  cat "$LOG_DIR/picks-register.json"
  fail "Picks buyer registration failed. HTTP $PICKS_REGISTER_HTTP"
fi

for _ in $(seq 1 30); do
  if [[ -s "$CAPTURE_FILE" ]]; then
    break
  fi
  sleep 0.5
done

if [[ ! -s "$CAPTURE_FILE" ]]; then
  fail "Verification URL was not captured for the picks buyer account."
fi

PICKS_VERIFICATION_URL="$(cat "$CAPTURE_FILE")"
PICKS_VERIFY_TOKEN="${PICKS_VERIFICATION_URL##*token=}"

if [[ -z "$PICKS_VERIFY_TOKEN" ]]; then
  fail "Picks buyer verification token could not be extracted."
fi

PICKS_VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/picks-verify.json" -w "%{http_code}" \
    --get \
    --data-urlencode "token=$PICKS_VERIFY_TOKEN" \
    "$API_URL$API_PREFIX/auth/verify-email"
)"

if [[ "$PICKS_VERIFY_HTTP" != "200" ]]; then
  cat "$LOG_DIR/picks-verify.json"
  fail "Picks buyer email verification failed. HTTP $PICKS_VERIFY_HTTP"
fi

PICKS_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/picks-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$PICKS_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"
)"

if [[ "$PICKS_LOGIN_HTTP" != "201" && "$PICKS_LOGIN_HTTP" != "200" ]]; then
  cat "$LOG_DIR/picks-login.json"
  fail "Picks buyer login failed. HTTP $PICKS_LOGIN_HTTP"
fi

PICKS_BUYER_TOKEN="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("accessToken",""))' < "$LOG_DIR/picks-login.json")"

request GET "$API_URL$API_PREFIX/products/picks?take=12" "" "$PICKS_BUYER_TOKEN" > "$LOG_DIR/picks-fresh.json"

python3 - "$LOG_DIR/picks-fresh.json" <<'PYJSON'
import json, sys

picks = json.load(open(sys.argv[1], encoding="utf-8"))
if not isinstance(picks, list) or picks != []:
    raise SystemExit("ERROR: fresh buyer should receive an empty picks list, got: " + json.dumps(picks)[:200])

print("✓ Fresh buyer received no fake picks")
PYJSON

echo
echo "[PICKS 3/4] The main buyer's picks come from their own order history..."

request GET "$API_URL$API_PREFIX/products/picks?take=12" "" "$ACCESS_TOKEN" > "$LOG_DIR/picks-buyer.json"

PICKS_ORDERED_IDS="$(
  psql "${E2E_PSQL_TARGET:-bonagri}" -v ON_ERROR_STOP=1 -At \
    -v email="$TEST_EMAIL" <<'SQL'
SELECT oi."productId" FROM "OrderItem" oi
JOIN "Order" o ON o.id = oi."orderId"
JOIN "User" u ON u.id = o."userId"
WHERE u.email = :'email' AND o.status <> 'CANCELLED';
SQL
)"

python3 - "$LOG_DIR/picks-buyer.json" "$PICKS_ORDERED_IDS" <<'PYJSON'
import json, sys

picks = json.load(open(sys.argv[1], encoding="utf-8"))
ordered = set(sys.argv[2].split())

if not isinstance(picks, list) or not picks:
    raise SystemExit("ERROR: main buyer should receive picks, got: " + json.dumps(picks)[:200])

overlap = [pick["id"] for pick in picks if pick["id"] in ordered]
if overlap:
    raise SystemExit("ERROR: picks repeat already-ordered products: " + ", ".join(overlap))

print(f"✓ {len(picks)} personalized picks, none already ordered")
PYJSON

echo
echo "[PICKS 4/4] The picks rail payload maps onto marketplace cards..."

python3 - "$LOG_DIR/picks-buyer.json" <<'PYJSON'
import json, sys

picks = json.load(open(sys.argv[1], encoding="utf-8"))
required = {"id", "slug", "name", "price", "unit", "status", "category", "supplier"}
for pick in picks:
    missing = required - set(pick)
    if missing:
        raise SystemExit(f"ERROR: pick {pick.get('id', '?')} is missing fields: {', '.join(sorted(missing))}")
    if pick.get("status") != "ACTIVE":
        raise SystemExit(f"ERROR: pick {pick['id']} is not ACTIVE")

print("✓ Picks carry the full public product shape and are all ACTIVE")
PYJSON

if [ -z "${ADMIN_TOKEN:-}" ]; then
  echo "⚠ Near-you section SKIPPED: admin login did not run."
else

echo
echo "[NEAR 1/3] Admin lights up a Near you campaign..."

# A dev-farm product: section N pinned that supplier, so geolocation
# matching has coordinates to measure from, and its city (Tzaneen) covers
# the city-match path.
NEAR_PRODUCT_ID="$(
  request GET "$API_URL$API_PREFIX/products" "" | python3 -c '
import json, sys
products = json.load(sys.stdin)
for product in products:
    supplier = product.get("supplier") or {}
    inventory = product.get("inventory") or {}
    sellable = inventory.get("quantity", 0) - inventory.get("reservedQuantity", 0)
    if (
        supplier.get("businessName") == "BonAgri Farm"
        and supplier.get("city") == "Tzaneen"
        and sellable > 0
    ):
        print(product["id"])
        break
else:
    raise SystemExit("ERROR: no sellable BonAgri Farm product for the near-you flow")
'
)"

NEAR_NAME="Smoke Near You $(date +%s)"

NEAR_PAYLOAD="$(
  python3 -c '
import json, sys
print(json.dumps({
    "name": sys.argv[1],
    "headline": "Smoke test nearby harvest",
    "description": "Created by the runtime smoke test.",
    "type": "NEAR_YOU",
    "status": "ACTIVE",
    "layout": "BANNER",
    "placement": "HOME_MID",
    "priority": 1000,
    "ctaText": "Shop nearby",
    "destinationType": "NONE",
    "products": [{"productId": sys.argv[2]}],
}))
' "$NEAR_NAME" "$NEAR_PRODUCT_ID"
)"

NEAR_CREATE_HTTP="$(
  curl -sS -o "$LOG_DIR/near-create.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/promotions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")" \
    -H "Content-Type: application/json" \
    -d "$NEAR_PAYLOAD"
)"

if [[ "$NEAR_CREATE_HTTP" != "201" && "$NEAR_CREATE_HTTP" != "200" ]]; then
  cat "$LOG_DIR/near-create.json"
  fail "Near-you campaign creation failed. HTTP $NEAR_CREATE_HTTP"
fi

NEAR_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("id",""))' "$LOG_DIR/near-create.json")"

if [[ -z "$NEAR_ID" ]]; then
  cat "$LOG_DIR/near-create.json"
  fail "Near-you campaign id could not be extracted."
fi

echo "✓ Near-you campaign $NEAR_ID created"

echo
echo "[NEAR 2/3] The public feed asks for a location, then matches coords and city..."

request GET "$API_URL$API_PREFIX/promotions?placement=HOME_MID&limit=10" "" > "$LOG_DIR/near-nolocation.json"
request GET "$API_URL$API_PREFIX/promotions?placement=HOME_MID&limit=10&lat=-23.88&lng=29.45" "" > "$LOG_DIR/near-coords.json"
request GET "$API_URL$API_PREFIX/promotions?placement=HOME_MID&limit=10&city=Tzaneen" "" > "$LOG_DIR/near-city.json"

python3 - "$LOG_DIR/near-nolocation.json" "$LOG_DIR/near-coords.json" "$LOG_DIR/near-city.json" "$NEAR_ID" <<'PYJSON'
import json, sys

nolocation, coords, city = (
    json.load(open(path, encoding="utf-8")) for path in sys.argv[1:4]
)
campaign_id = sys.argv[4]

def find(campaigns):
    return next((c for c in campaigns if c.get("id") == campaign_id), None)

waiting = find(nolocation)
if waiting is None:
    raise SystemExit("ERROR: near-you card missing from the location-less feed")
near_you = waiting.get("nearYou") or {}
if near_you.get("needsLocation") is not True:
    raise SystemExit("ERROR: near-you card should ask for a location, got: " + json.dumps(near_you))
if "Tzaneen" not in near_you.get("locationOptions", []):
    raise SystemExit("ERROR: location options should offer Tzaneen, got: " + json.dumps(near_you.get("locationOptions")))
if waiting.get("products"):
    raise SystemExit("ERROR: a waiting near-you card must not show products yet")

by_coords = find(coords)
if by_coords is None:
    raise SystemExit("ERROR: near-you card missing for the coordinates query")
coord_products = by_coords.get("products") or []
if not coord_products:
    raise SystemExit("ERROR: coordinates query returned no nearby products")
if not isinstance(coord_products[0].get("distanceKm"), (int, float)):
    raise SystemExit("ERROR: nearby products should carry a numeric distanceKm, got: " + json.dumps(coord_products[0].get("distanceKm")))
if (by_coords.get("nearYou") or {}).get("needsLocation") is not False:
    raise SystemExit("ERROR: coordinates query should satisfy the location request")

by_city = find(city)
if by_city is None:
    raise SystemExit("ERROR: near-you card missing for the city query")
if not (by_city.get("products") or []):
    raise SystemExit("ERROR: city=Tzaneen query returned no nearby products")
if (by_city.get("nearYou") or {}).get("needsLocation") is not False:
    raise SystemExit("ERROR: city query should satisfy the location request")

print("✓ Near-you card prompts, then matches by distance and by city")
PYJSON

echo
echo "[NEAR 3/3] The campaign can be removed again..."

NEAR_DELETE_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" \
    -X DELETE "$API_URL$API_PREFIX/admin/promotions/$NEAR_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "X-Step-Up: $(admin_step_up "$ADMIN_TOKEN")"
)"

if [[ "$NEAR_DELETE_HTTP" != "200" ]]; then
  fail "Near-you campaign cleanup failed. HTTP $NEAR_DELETE_HTTP"
fi

request GET "$API_URL$API_PREFIX/promotions?placement=HOME_MID&limit=10" "" > "$LOG_DIR/near-deleted.json"

python3 - "$LOG_DIR/near-deleted.json" "$NEAR_ID" <<'PYJSON'
import json, sys

campaigns = json.load(open(sys.argv[1], encoding="utf-8"))
campaign_id = sys.argv[2]
if any(c.get("id") == campaign_id for c in campaigns):
    raise SystemExit("ERROR: deleted near-you campaign is still public")

print("✓ Deleted near-you campaign removed from the public feed")
PYJSON

fi

echo
echo "✓ LISTINGS SIGNALS FLOW ACCEPTANCE PASSED"

echo
echo "ADMIN 2FA FLOW"
echo "========================================"

# HP2: mandatory admin TOTP (plan §HP2). Runs BEFORE the rate-limiting
# section on purpose — L hammers /auth/login and this flow performs several
# real logins itself (bucket: 15/min, T spends 5). Same guarded admin
# credentials as the dispute/admin sections; enrolment state for the next
# run is cached in .runtime-test/admin-2fa-state.json by admin_login.

if [ -z "${ADMIN_E2E_PASSWORD:-}" ]; then
  echo "⚠ Admin 2FA section SKIPPED: no SEED_ADMIN_PASSWORD in api/.env and no ADMIN_E2E_PASSWORD env var."
else

# The login bucket is 15/min shared per IP, and T performs 4 real logins in
# quick succession right after other sections logged in. Wait out any recent
# burst FIRST so T always starts with a full window (same discipline L relies
# on with its own sleep) — otherwise T3's login can come back 429 and look
# like a missing pre-auth token.
echo
echo "[T0] Waiting out the login throttle window..."
sleep 61
echo "✓ Login window clear"

echo
echo "[T1/6] Disable 2FA with password + TOTP, then prove the login mandate..."

T_TOKEN="$(admin_login "$ADMIN_E2E_EMAIL" "$ADMIN_E2E_PASSWORD")"
if [ -z "$T_TOKEN" ]; then
  fail "Admin 2FA section: login returned no token"
fi

T_SECRET="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["secret"])' "$ADMIN_2FA_STATE")"
T_CODE="$(admin_totp "$T_SECRET")"

T_DISABLE_HTTP="$(
  curl -sS -o "$LOG_DIR/t-disable.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/2fa/disable" \
    -H "Authorization: Bearer $T_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"password":sys.argv[1],"code":sys.argv[2]}))' "$ADMIN_E2E_PASSWORD" "$T_CODE")"
)"
if [ "$T_DISABLE_HTTP" != "201" ]; then
  cat "$LOG_DIR/t-disable.json"
  fail "2FA disable (password + TOTP) failed. HTTP $T_DISABLE_HTTP"
fi
echo "✓ 2FA disabled with password + TOTP"

T_LOGIN_FILE="$LOG_DIR/t-login.json"
T_HTTP="$(
  curl -sS -o "$T_LOGIN_FILE" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$ADMIN_E2E_EMAIL" "$ADMIN_E2E_PASSWORD")"
)"
if [ "$T_HTTP" != "201" ]; then
  cat "$T_LOGIN_FILE"
  fail "Mandate check: admin login failed. HTTP $T_HTTP"
fi

python3 - "$T_LOGIN_FILE" <<'PYJSON'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
if not d.get("twoFactorSetupRequired"):
    raise SystemExit("ERROR: unenrolled admin login did not demand enrolment (2FA is not mandatory?)")
if d.get("accessToken"):
    raise SystemExit("ERROR: unenrolled admin login returned a JWT without 2FA")
if not d.get("preAuthToken"):
    raise SystemExit("ERROR: enrolment login returned no pre-auth token")
print("✓ Unenrolled admin gets no JWT — enrolment is mandatory")
PYJSON

echo
echo "[T2/6] Fresh enrolment: setup + enable with a real TOTP code..."

T_PRE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["preAuthToken"])' "$T_LOGIN_FILE")"

T_SETUP_FILE="$LOG_DIR/t-setup.json"
T_HTTP="$(
  curl -sS -o "$T_SETUP_FILE" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/2fa/setup" \
    -H "Authorization: Bearer $T_PRE"
)"
if [ "$T_HTTP" != "201" ]; then
  cat "$T_SETUP_FILE"
  fail "2FA setup failed. HTTP $T_HTTP"
fi

T_NEW_SECRET="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["secret"])' "$T_SETUP_FILE")"

T_ENABLE_FILE="$LOG_DIR/t-enable.json"
T_HTTP="$(
  curl -sS -o "$T_ENABLE_FILE" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/2fa/enable" \
    -H "Authorization: Bearer $T_PRE" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"code":sys.argv[1]}))' "$(admin_totp "$T_NEW_SECRET")")"
)"
if [ "$T_HTTP" != "201" ]; then
  cat "$T_ENABLE_FILE"
  fail "2FA enable failed (TOTP mismatch between smoke and API?). HTTP $T_HTTP"
fi

# Persist the NEW enrolment state — the old secret died with the disable.
python3 - "$T_ENABLE_FILE" "$T_NEW_SECRET" "$ADMIN_2FA_STATE" <<'PYSTATE'
import json, sys
enable = json.load(open(sys.argv[1], encoding="utf-8"))
state = {"secret": sys.argv[2], "recoveryCodes": enable.get("recoveryCodes", [])}
with open(sys.argv[3], "w", encoding="utf-8") as f:
    json.dump(state, f, indent=2)
PYSTATE

T_TOKEN2="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["accessToken"])' "$T_ENABLE_FILE")"
if [ -z "$T_TOKEN2" ]; then
  fail "Enrolment did not complete the login (no access token from /auth/2fa/enable)"
fi

curl -sS "$API_URL$API_PREFIX/auth/me" \
  -H "Authorization: Bearer $T_TOKEN2" > "$LOG_DIR/t-me.json"
python3 - "$LOG_DIR/t-me.json" <<'PYJSON'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
if d.get("role") != "ADMIN" or d.get("twoFactorEnabled") is not True:
    raise SystemExit("ERROR: enrolment session / me payload wrong: %s" % json.dumps(d))
print("✓ Enrolment completes the login — recovery codes shown once, session live, /auth/me reports 2FA on")
PYJSON

echo
echo "[T3/6] Wrong code rejected; valid code mints the JWT; pre-auth is single-use..."

T_LOGIN2_FILE="$LOG_DIR/t-login2.json"
T_HTTP="$(
  curl -sS -o "$T_LOGIN2_FILE" -w "%{http_code}" -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$ADMIN_E2E_EMAIL" "$ADMIN_E2E_PASSWORD")"
)"
if [ "$T_HTTP" == "429" ]; then
  fail "Enrolled admin login was throttled (429) — the T0 window wait should have prevented this"
fi
if [ "$T_HTTP" != "201" ]; then
  cat "$T_LOGIN2_FILE"
  fail "Enrolled admin login failed. HTTP $T_HTTP"
fi
T_PRE2="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("preAuthToken",""))' "$T_LOGIN2_FILE")"
if [ -z "$T_PRE2" ]; then
  cat "$T_LOGIN2_FILE"
  fail "Enrolled admin login returned no pre-auth token"
fi

# Off-by-one from the CURRENT code — deterministic and outside the ±1 drift
# window (python handles the zero-padded base-10 math; bash $(( )) would
# treat a leading zero as octal).
T_WRONG_CODE="$(
  python3 -c 'import sys; print(f"{(int(sys.argv[1]) + 1) % 1000000:06d}")' \
    "$(admin_totp "$T_NEW_SECRET")"
)"

T_VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/t-verify-wrong.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/2fa/verify" \
    -H "Authorization: Bearer $T_PRE2" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"code":sys.argv[1]}))' "$T_WRONG_CODE")"
)"
if [ "$T_VERIFY_HTTP" != "401" ]; then
  cat "$LOG_DIR/t-verify-wrong.json"
  fail "Wrong 2FA code must be rejected with 401. Got HTTP $T_VERIFY_HTTP"
fi
echo "✓ Wrong code rejected with 401"

T_VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/t-verify-ok.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/2fa/verify" \
    -H "Authorization: Bearer $T_PRE2" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"code":sys.argv[1]}))' "$(admin_totp "$T_NEW_SECRET")")"
)"
if [ "$T_VERIFY_HTTP" != "201" ]; then
  cat "$LOG_DIR/t-verify-ok.json"
  fail "Valid 2FA code must complete the login. HTTP $T_VERIFY_HTTP"
fi
echo "✓ Valid code completes the login"

T_VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/t-verify-replay.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/2fa/verify" \
    -H "Authorization: Bearer $T_PRE2" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"code":sys.argv[1]}))' "$(admin_totp "$T_NEW_SECRET")")"
)"
if [ "$T_VERIFY_HTTP" != "401" ]; then
  cat "$LOG_DIR/t-verify-replay.json"
  fail "A consumed pre-auth token must be rejected on replay. HTTP $T_VERIFY_HTTP"
fi
echo "✓ Pre-auth replay rejected with 401 (single-use)"

echo
echo "[T4/6] Recovery codes work exactly once..."

T_RECOVERY_1="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["recoveryCodes"][0])' "$ADMIN_2FA_STATE")"

T_LOGIN3_FILE="$LOG_DIR/t-login3.json"
curl -sS -o "$T_LOGIN3_FILE" -X POST "$API_URL$API_PREFIX/auth/login" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$ADMIN_E2E_EMAIL" "$ADMIN_E2E_PASSWORD")" > /dev/null
T_PRE3="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("preAuthToken",""))' "$T_LOGIN3_FILE")"

T_VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/t-recovery-ok.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/2fa/verify" \
    -H "Authorization: Bearer $T_PRE3" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"code":sys.argv[1]}))' "$T_RECOVERY_1")"
)"
if [ "$T_VERIFY_HTTP" != "201" ]; then
  cat "$LOG_DIR/t-recovery-ok.json"
  fail "Recovery code must complete the login. HTTP $T_VERIFY_HTTP"
fi
echo "✓ Recovery code completes the login"

T_LOGIN4_FILE="$LOG_DIR/t-login4.json"
T_HTTP="$(
  curl -sS -o "$T_LOGIN4_FILE" -w "%{http_code}" -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$ADMIN_E2E_EMAIL" "$ADMIN_E2E_PASSWORD")"
)"
if [ "$T_HTTP" == "429" ]; then
  fail "Recovery-test login was throttled (429) — the T0 window wait should have prevented this"
fi
if [ "$T_HTTP" != "201" ]; then
  cat "$T_LOGIN4_FILE"
  fail "Recovery-test admin login failed. HTTP $T_HTTP"
fi
T_PRE4="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("preAuthToken",""))' "$T_LOGIN4_FILE")"
if [ -z "$T_PRE4" ]; then
  cat "$T_LOGIN4_FILE"
  fail "Recovery-test login returned no pre-auth token"
fi

T_VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/t-recovery-used.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/2fa/verify" \
    -H "Authorization: Bearer $T_PRE4" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"code":sys.argv[1]}))' "$T_RECOVERY_1")"
)"
if [ "$T_VERIFY_HTTP" != "401" ]; then
  cat "$LOG_DIR/t-recovery-used.json"
  fail "A used recovery code must be rejected with 401. HTTP $T_VERIFY_HTTP"
fi
echo "✓ Used recovery code rejected with 401 (single-use)"

# Drop the consumed code from the cached state so a later run never wastes it.
python3 - "$ADMIN_2FA_STATE" "$T_RECOVERY_1" <<'PYSTATE'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    state = json.load(f)
used = sys.argv[2]
state["recoveryCodes"] = [c for c in state.get("recoveryCodes", []) if c != used]
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(state, f, indent=2)
PYSTATE

echo
echo "[T5/6] Sign-in alert email captured with IP + time..."

if [ ! -f "$ADMIN_LOGIN_CAPTURE_FILE" ]; then
  fail "No admin sign-in alert captured at $ADMIN_LOGIN_CAPTURE_FILE"
fi
python3 - "$ADMIN_LOGIN_CAPTURE_FILE" "$ADMIN_E2E_EMAIL" <<'PYJSON'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
if d.get("email") != sys.argv[2]:
    raise SystemExit("ERROR: alert captured for %s, expected %s" % (d.get("email"), sys.argv[2]))
if not d.get("ip"):
    raise SystemExit("ERROR: alert has no IP: %s" % json.dumps(d))
if not d.get("signedInAt"):
    raise SystemExit("ERROR: alert has no timestamp: %s" % json.dumps(d))
print("✓ Sign-in alert captured (email + IP + time)")
PYJSON

echo
echo "[T6/6] Seed admin left enrolled with the cached secret for the next run..."
if [ ! -f "$ADMIN_2FA_STATE" ]; then
  fail "State file $ADMIN_2FA_STATE missing — next run could not log in"
fi
python3 - "$ADMIN_2FA_STATE" <<'PYJSON'
import json, sys
state = json.load(open(sys.argv[1], encoding="utf-8"))
assert state.get("secret"), "state has no secret"
assert len(state.get("recoveryCodes", [])) >= 9, "expected the 9 unused recovery codes"
print("✓ Enrolment state cached (secret + remaining recovery codes)")
PYJSON

echo
echo "✓ ADMIN 2FA FLOW ACCEPTANCE PASSED"

fi

echo
echo "ADMIN STEP-UP + AUDIT FLOW"
echo "========================================"

# HP3 (plan G3): dangerous admin mutations need a fresh password confirmation
# (POST /auth/step-up → X-Step-Up header) and every guarded mutation writes an
# AdminAuditLog row in the SAME transaction as the change. Runs after T (T
# owns the login window it waits out; U adds one login) and BEFORE L (L
# hammers /auth/login — U mints step-up tokens, a different bucket, but keeps
# the discipline anyway). Section U uses BANNER mutations because they clean
# up after themselves: create → patch → delete leaves only audit rows.
# (Plan §HP3 calls this section O; O is CP16a's media flow — same deviation
# HP2 recorded for its N → T rename.)

if [ -z "${ADMIN_E2E_PASSWORD:-}" ]; then
  echo "⚠ Step-up/audit section SKIPPED: no SEED_ADMIN_PASSWORD in api/.env and no ADMIN_E2E_PASSWORD env var."
else

U_TOKEN="$(admin_login "$ADMIN_E2E_EMAIL" "$ADMIN_E2E_PASSWORD")"
if [ -z "$U_TOKEN" ]; then
  fail "Step-up section: login returned no token"
fi

U_ADMIN_ID="$(
  curl -sS "$API_URL$API_PREFIX/auth/me" \
    -H "Authorization: Bearer $U_TOKEN" > "$LOG_DIR/u-me.json"
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/u-me.json"
)"
if [ -z "$U_ADMIN_ID" ]; then
  cat "$LOG_DIR/u-me.json"
  fail "Step-up section: could not resolve the admin user id"
fi

U_BANNER_TITLE="HP3 Smoke Banner $(date +%s)"

# One banner POST reused by the negative tests — the response body is only
# inspected when the call is EXPECTED to succeed. No array for the optional
# header: an empty "${arr[@]}" under `set -u` is an unbound-variable error on
# the bash 3.2 this script runs on.
u_post_banner() {
  local out_file="$1"
  local step_up="${2:-}"

  if [ -n "$step_up" ]; then
    curl -sS -o "$out_file" -w "%{http_code}" \
      -X POST "$API_URL$API_PREFIX/admin/banners" \
      -H "Authorization: Bearer $U_TOKEN" \
      -H "X-Step-Up: $step_up" \
      -H "Content-Type: application/json" \
      -d "$(python3 -c 'import json,sys; print(json.dumps({"title":sys.argv[1]}))' "$U_BANNER_TITLE")"
  else
    curl -sS -o "$out_file" -w "%{http_code}" \
      -X POST "$API_URL$API_PREFIX/admin/banners" \
      -H "Authorization: Bearer $U_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$(python3 -c 'import json,sys; print(json.dumps({"title":sys.argv[1]}))' "$U_BANNER_TITLE")"
  fi
}

echo
echo "[U1/5] Wrong password cannot mint a step-up; a missing header is refused..."

U_BAD_HTTP="$(
  curl -sS -o "$LOG_DIR/u-stepup-bad.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/step-up" \
    -H "Authorization: Bearer $U_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"password":"definitely-not-the-password"}'
)"
if [ "$U_BAD_HTTP" != "401" ]; then
  cat "$LOG_DIR/u-stepup-bad.json"
  fail "Step-up with a wrong password must 401. HTTP $U_BAD_HTTP"
fi
echo "✓ Wrong password rejected with 401 (nothing minted)"

U_NOHEADER_HTTP="$(u_post_banner "$LOG_DIR/u-no-header.json")"
if [ "$U_NOHEADER_HTTP" != "403" ]; then
  cat "$LOG_DIR/u-no-header.json"
  fail "Guarded mutation without X-Step-Up must 403. HTTP $U_NOHEADER_HTTP"
fi

python3 - "$LOG_DIR/u-no-header.json" <<'PYJSON'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
if d.get("code") != "STEP_UP_REQUIRED":
    raise SystemExit("ERROR: expected machine-readable STEP_UP_REQUIRED, got: " + json.dumps(d))
print("✓ Missing header → 403 with code STEP_UP_REQUIRED")
PYJSON

request GET "$API_URL$API_PREFIX/admin/banners" "" "$U_TOKEN" > "$LOG_DIR/u-banners-after-403.json"
python3 - "$LOG_DIR/u-banners-after-403.json" "$U_BANNER_TITLE" <<'PYJSON'
import json, sys
banners = json.load(open(sys.argv[1], encoding="utf-8"))
if any(b.get("title") == sys.argv[2] for b in banners):
    raise SystemExit("ERROR: banner created without step-up confirmation")
print("✓ No side effect from the refused call")
PYJSON

echo
echo "[U2/5] Forged and expired step-up headers are rejected server-side..."

# The access token is signed with JWT_SECRET — presented as X-Step-Up it can
# never verify against the derived step-up secret.
U_FORGED_HTTP="$(u_post_banner "$LOG_DIR/u-forged.json" "$U_TOKEN")"
if [ "$U_FORGED_HTTP" != "403" ]; then
  cat "$LOG_DIR/u-forged.json"
  fail "Access token in X-Step-Up must 403. HTTP $U_FORGED_HTTP"
fi

# A structurally perfect but EXPIRED step-up token: signed here with the same
# derived secret (sha256(JWT_SECRET + ":step-up")) and an exp in the past.
# The secret itself is read from api/.env inside node and never printed.
U_EXPIRED="$(
  node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    const env = fs.readFileSync(process.argv[1], "utf8");
    const m = env.match(/^JWT_SECRET=(.*)$/m);
    if (!m) { console.error("no JWT_SECRET in api/.env"); process.exit(2); }
    const secret = m[1].trim().replace(/^["\x27]|["\x27]$/g, "");
    const derived = crypto.createHash("sha256").update(secret + ":step-up").digest("hex");
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const head = b64({ alg: "HS256", typ: "JWT" });
    const body = b64({ sub: process.argv[2], type: "step-up", iat: now - 600, exp: now - 300 });
    const sig = crypto.createHmac("sha256", derived).update(head + "." + body).digest("base64url");
    process.stdout.write(head + "." + body + "." + sig);
  ' "$API/.env" "$U_ADMIN_ID"
)"
if [ -z "$U_EXPIRED" ]; then
  fail "Could not mint an expired step-up token"
fi

U_EXPIRED_HTTP="$(u_post_banner "$LOG_DIR/u-expired.json" "$U_EXPIRED")"
if [ "$U_EXPIRED_HTTP" != "403" ]; then
  cat "$LOG_DIR/u-expired.json"
  fail "Expired step-up token must 403. HTTP $U_EXPIRED_HTTP"
fi

python3 - "$LOG_DIR/u-forged.json" "$LOG_DIR/u-expired.json" <<'PYJSON'
import json, sys
for path in sys.argv[1:]:
    d = json.load(open(path, encoding="utf-8"))
    if d.get("code") != "STEP_UP_REQUIRED":
        raise SystemExit("ERROR: expected STEP_UP_REQUIRED from " + path + ", got: " + json.dumps(d))
print("✓ Forged and expired headers rejected with STEP_UP_REQUIRED")
PYJSON

echo
echo "[U3/5] A password-confirmed step-up unlocks the mutation..."

U_STEP="$(admin_step_up "$U_TOKEN")"
if [ -z "$U_STEP" ]; then
  fail "Step-up section: mint returned no token"
fi

U_CREATE_HTTP="$(u_post_banner "$LOG_DIR/u-banner-create.json" "$U_STEP")"
if [ "$U_CREATE_HTTP" != "201" ]; then
  cat "$LOG_DIR/u-banner-create.json"
  fail "Guarded banner create with a valid step-up failed. HTTP $U_CREATE_HTTP"
fi

U_BANNER_ID="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("id",""))' "$LOG_DIR/u-banner-create.json"
)"
if [ -z "$U_BANNER_ID" ]; then
  cat "$LOG_DIR/u-banner-create.json"
  fail "Banner create returned no id"
fi
echo "✓ Valid step-up accepted — banner $U_BANNER_ID created"

echo
echo "[U4/5] The mutation is in /admin/audit, filterable by action..."

request GET "$API_URL$API_PREFIX/admin/audit?action=BANNER_CREATE&limit=10" "" "$U_TOKEN" > "$LOG_DIR/u-audit-create.json"
python3 - "$LOG_DIR/u-audit-create.json" "$U_BANNER_ID" "$U_BANNER_TITLE" "$ADMIN_E2E_EMAIL" <<'PYJSON'
import json, sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
banner_id, title, email = sys.argv[2], sys.argv[3], sys.argv[4]
items = data.get("items") or []

match = next((i for i in items if i.get("targetId") == banner_id), None)
if match is None:
    raise SystemExit("ERROR: audit feed missing BANNER_CREATE row for the banner: " + json.dumps(items)[:400])
if match.get("action") != "BANNER_CREATE":
    raise SystemExit("ERROR: audit action mismatch: " + json.dumps(match))
if (match.get("actor") or {}).get("email") != email:
    raise SystemExit("ERROR: audit actor is not the acting admin: " + json.dumps(match))
metadata = match.get("metadata") or {}
if metadata.get("title") != title:
    raise SystemExit("ERROR: audit metadata lost the title: " + json.dumps(match))
if "BANNER_CREATE" not in (data.get("actions") or []):
    raise SystemExit("ERROR: distinct action list missing BANNER_CREATE: " + json.dumps(data.get("actions")))
print("✓ BANNER_CREATE row present (actor, target, metadata) and filter works")
PYJSON

request GET "$API_URL$API_PREFIX/admin/audit?limit=5" "" "$U_TOKEN" > "$LOG_DIR/u-audit-feed.json"
python3 - "$LOG_DIR/u-audit-feed.json" <<'PYJSON'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
items = data.get("items") or []
if not items:
    raise SystemExit("ERROR: audit feed is empty after guarded mutations")
print("✓ Audit feed returns {} recent row(s), newest first".format(len(items)))
PYJSON

# The cached step-up is deliberately reused here — one password confirmation
# covers a burst of actions (not single-use within its 5-minute TTL).
U_STEP_AGAIN="$(admin_step_up "$U_TOKEN")"
if [ "$U_STEP_AGAIN" != "$U_STEP" ]; then
  fail "Step-up cache unexpectedly re-minted inside the TTL"
fi
echo "✓ Same step-up token reused for the next action (not single-use)"

echo
echo "[U5/5] Patch and delete also guarded; the trail survives cleanup..."

U_PATCH_HTTP="$(
  curl -sS -o "$LOG_DIR/u-banner-patch.json" -w "%{http_code}" \
    -X PATCH "$API_URL$API_PREFIX/admin/banners/$U_BANNER_ID" \
    -H "Authorization: Bearer $U_TOKEN" \
    -H "X-Step-Up: $U_STEP_AGAIN" \
    -H "Content-Type: application/json" \
    -d '{"subtitle":"stepped-up edit"}'
)"
if [ "$U_PATCH_HTTP" != "200" ]; then
  cat "$LOG_DIR/u-banner-patch.json"
  fail "Guarded banner patch failed. HTTP $U_PATCH_HTTP"
fi

U_DELETE_HTTP="$(
  curl -sS -o "$LOG_DIR/u-banner-delete.json" -w "%{http_code}" \
    -X DELETE "$API_URL$API_PREFIX/admin/banners/$U_BANNER_ID" \
    -H "Authorization: Bearer $U_TOKEN" \
    -H "X-Step-Up: $U_STEP_AGAIN"
)"
if [ "$U_DELETE_HTTP" != "200" ]; then
  cat "$LOG_DIR/u-banner-delete.json"
  fail "Guarded banner delete failed. HTTP $U_DELETE_HTTP"
fi
echo "✓ Patch and delete completed under the same step-up"

request GET "$API_URL$API_PREFIX/admin/audit?action=BANNER_DELETE&limit=10" "" "$U_TOKEN" > "$LOG_DIR/u-audit-delete.json"
python3 - "$LOG_DIR/u-audit-delete.json" "$U_BANNER_ID" <<'PYJSON'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
items = data.get("items") or []
if not any(i.get("targetId") == sys.argv[2] for i in items):
    raise SystemExit("ERROR: BANNER_DELETE audit row missing: " + json.dumps(items)[:400])
print("✓ BANNER_DELETE row present after cleanup (trail survives the mutation)")
PYJSON

echo
echo "✓ ADMIN STEP-UP + AUDIT FLOW ACCEPTANCE PASSED"

fi

echo
echo "ACCOUNT RECOVERY FLOW (PASSWORD RESET)"
echo "========================================"

# HP4 (plan G4): a buyer who forgot their password recovers access end to end
# WITHOUT db surgery — forgot-password answers 202 for known and unknown
# addresses alike (no enumeration oracle), the emailed link is single-use, and
# the old password dies with it. Runs BEFORE L (L hammers /auth/login and owns
# that window; W still performs real logins) and spends only its own
# /auth/forgot-password budget (5/min).
# (Plan §HP4 calls this section P; P is CP-promotions' campaign flow — the
# same letter-collision deviation HP2/HP3 recorded for N → T and O → U.
# Q stays reserved for HP5.)

echo
echo "[W1/8] Register a dedicated recovery account..."

W_EMAIL="hp4_recovery_$(date +%s)_$$@bonagri.local"
W_OLD_PASSWORD="Original-Restore-789"
W_NEW_PASSWORD="Recovered-Access-456"

# The verification capture file still holds section F/M/PICKS' URL — clear it
# so this poll can only pass on W's own link.
rm -f "$CAPTURE_FILE"

W_REGISTER_HTTP="$(
  curl -sS -o "$LOG_DIR/w-register.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$W_EMAIL\",\"password\":\"$W_OLD_PASSWORD\",\"firstName\":\"Recovery\",\"lastName\":\"Tester\"}")"

if [[ "$W_REGISTER_HTTP" != "201" ]]; then
  cat "$LOG_DIR/w-register.json"
  fail "Recovery account registration failed. HTTP $W_REGISTER_HTTP"
fi

for _ in $(seq 1 30); do
  if [[ -s "$CAPTURE_FILE" ]]; then
    break
  fi
  sleep 0.5
done

if [[ ! -s "$CAPTURE_FILE" ]]; then
  fail "Recovery account verification URL was not captured."
fi

W_VERIFY_TOKEN="$(cat "$CAPTURE_FILE")"
W_VERIFY_TOKEN="${W_VERIFY_TOKEN##*token=}"

W_VERIFY_HTTP="$(
  curl -sS -o "$LOG_DIR/w-verify.json" -w "%{http_code}" \
    "$API_URL$API_PREFIX/auth/verify-email?token=$W_VERIFY_TOKEN")"

if [[ "$W_VERIFY_HTTP" != "200" && "$W_VERIFY_HTTP" != "201" ]]; then
  cat "$LOG_DIR/w-verify.json"
  fail "Recovery account email verification failed. HTTP $W_VERIFY_HTTP"
fi

echo "✓ Dedicated recovery account registered and verified"

echo
echo "[W2/8] The account signs in with its original password..."

W_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/w-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$W_EMAIL" "$W_OLD_PASSWORD")"
)"

if [[ "$W_LOGIN_HTTP" != "201" ]]; then
  cat "$LOG_DIR/w-login.json"
  fail "Baseline login failed. HTTP $W_LOGIN_HTTP"
fi

W_HASH_BEFORE="$(psql "${E2E_PSQL_TARGET:-bonagri}" -v ON_ERROR_STOP=1 -v email="$W_EMAIL" -At <<'SQL' || true
SELECT "passwordHash" FROM "User" WHERE "email" = :'email';
SQL
)"

case "$W_HASH_BEFORE" in
  '$2'*) ;;
  *) fail "Could not read the account's bcrypt hash before the reset." ;;
esac

echo "✓ Original password signs in; bcrypt hash recorded"

echo
echo "[W3/8] forgot-password answers 202 and mails a captured link..."

rm -f "$RESET_CAPTURE_FILE"

W_FORGOT_HTTP="$(
  curl -sS -o "$LOG_DIR/w-forgot.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/forgot-password" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$W_EMAIL\"}"
)"

if [[ "$W_FORGOT_HTTP" != "202" ]]; then
  cat "$LOG_DIR/w-forgot.json"
  fail "forgot-password must answer 202 (never 201/404). HTTP $W_FORGOT_HTTP"
fi

if ! grep -q '"passwordResetRequested"[[:space:]]*:[[:space:]]*true' "$LOG_DIR/w-forgot.json"; then
  cat "$LOG_DIR/w-forgot.json"
  fail "forgot-password did not return the generic confirmation."
fi

for _ in $(seq 1 30); do
  if [[ -s "$RESET_CAPTURE_FILE" ]]; then
    break
  fi
  sleep 0.5
done

if [[ ! -s "$RESET_CAPTURE_FILE" ]]; then
  fail "Password reset link was not captured."
fi

W_RESET_URL="$(cat "$RESET_CAPTURE_FILE")"

if [[ "$W_RESET_URL" != *"/reset-password?token="* ]]; then
  cat "$RESET_CAPTURE_FILE"
  fail "Captured reset URL is invalid."
fi

W_RESET_TOKEN="${W_RESET_URL##*token=}"

if [[ -z "$W_RESET_TOKEN" ]]; then
  fail "Reset token could not be extracted."
fi

echo "✓ 202 + reset link captured (raw token only travels in the email)"

echo
echo "[W4/8] An unknown address gets the identical 202 and no link..."

rm -f "$RESET_CAPTURE_FILE"
W_GHOST_EMAIL="hp4_ghost_$(date +%s)_$$@bonagri.local"

W_GHOST_HTTP="$(
  curl -sS -o "$LOG_DIR/w-forgot-ghost.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/forgot-password" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$W_GHOST_EMAIL\"}"
)"

if [[ "$W_GHOST_HTTP" != "202" ]]; then
  cat "$LOG_DIR/w-forgot-ghost.json"
  fail "Unknown address must also get 202. HTTP $W_GHOST_HTTP"
fi

python3 - "$LOG_DIR/w-forgot.json" "$LOG_DIR/w-forgot-ghost.json" <<'PYJSON'
import json, sys
known = json.load(open(sys.argv[1], encoding="utf-8"))
ghost = json.load(open(sys.argv[2], encoding="utf-8"))
if known.get("message") != ghost.get("message"):
    raise SystemExit(
        "ERROR: known/unknown responses differ — enumeration oracle: "
        + json.dumps([known, ghost])[:400]
    )
print("✓ Known and unknown addresses return the same message")
PYJSON

if [[ -e "$RESET_CAPTURE_FILE" ]]; then
  fail "A reset link was minted for an address that does not exist."
fi

echo "✓ No link minted for the unknown address"

echo
echo "[W5/8] forgot-password is capped at 5 requests per minute..."

# W3 + W4 already spent two of the five slots in this window.
for W_I in $(seq 1 3); do
  W_BUDGET_HTTP="$(
    curl -sS -o "$LOG_DIR/w-budget-$W_I.json" -w "%{http_code}" \
      -X POST "$API_URL$API_PREFIX/auth/forgot-password" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$W_GHOST_EMAIL\"}"
  )"

  if [[ "$W_BUDGET_HTTP" == "429" ]]; then
    fail "forgot-password throttled after only $((2 + W_I)) requests (limit is 5/min)"
  fi
done

W_BLOCKED_HTTP="$(
  curl -sS -o "$LOG_DIR/w-throttle-blocked.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/forgot-password" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$W_GHOST_EMAIL\"}"
)"

if [[ "$W_BLOCKED_HTTP" != "429" ]]; then
  cat "$LOG_DIR/w-throttle-blocked.json"
  fail "forgot-password was never rate limited (6th request: HTTP $W_BLOCKED_HTTP)"
fi

echo "✓ forgot-password blocked with 429 on request 6 of the 5/min budget"

echo
echo "[W6/8] The emailed link sets a new password and is burned..."

W_RESET_HTTP="$(
  curl -sS -o "$LOG_DIR/w-reset.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/reset-password" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$W_RESET_TOKEN\",\"password\":\"$W_NEW_PASSWORD\"}"
)"

if [[ "$W_RESET_HTTP" != "201" ]]; then
  cat "$LOG_DIR/w-reset.json"
  fail "reset-password rejected the emailed link. HTTP $W_RESET_HTTP"
fi

if ! grep -q '"passwordUpdated"[[:space:]]*:[[:space:]]*true' "$LOG_DIR/w-reset.json"; then
  cat "$LOG_DIR/w-reset.json"
  fail "reset-password did not confirm the update."
fi

W_HASH_AFTER="$(psql "${E2E_PSQL_TARGET:-bonagri}" -v ON_ERROR_STOP=1 -v email="$W_EMAIL" -At <<'SQL' || true
SELECT "passwordHash" FROM "User" WHERE "email" = :'email';
SQL
)"

if [[ -z "$W_HASH_AFTER" || "$W_HASH_AFTER" == "$W_HASH_BEFORE" ]]; then
  fail "passwordHash did not change after a successful reset."
fi

case "$W_HASH_AFTER" in
  '$2'*) ;;
  *) fail "The new hash is not a bcrypt digest." ;;
esac

# Every link ever minted for this account must now be burned — a live row
# after a successful reset would mean the single-use guarantee is broken.
W_TOKEN_STATE="$(psql "${E2E_PSQL_TARGET:-bonagri}" -v ON_ERROR_STOP=1 -v email="$W_EMAIL" -At <<'SQL' || true
SELECT count(*) || '/' || count(t."usedAt")
FROM "PasswordResetToken" t
JOIN "User" u ON u."id" = t."userId"
WHERE u."email" = :'email';
SQL
)"

W_TOKENS_TOTAL="${W_TOKEN_STATE%%/*}"
W_TOKENS_USED="${W_TOKEN_STATE##*/}"

if [[ -z "$W_TOKENS_TOTAL" || "$W_TOKENS_TOTAL" == "0" ]]; then
  fail "No reset token rows exist for the recovery account."
fi

if [[ "$W_TOKENS_TOTAL" != "$W_TOKENS_USED" ]]; then
  fail "Reset tokens left live after the reset: $W_TOKEN_STATE (total/used)"
fi

echo "✓ Password hash swapped and all $W_TOKENS_TOTAL token row(s) burned"

echo
echo "[W7/8] The old password is dead; the new one signs in..."

W_OLD_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/w-old-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$W_EMAIL" "$W_OLD_PASSWORD")"
)"

if [[ "$W_OLD_LOGIN_HTTP" != "401" ]]; then
  cat "$LOG_DIR/w-old-login.json"
  fail "Old password still works after the reset. HTTP $W_OLD_LOGIN_HTTP"
fi

W_NEW_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/w-new-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$W_EMAIL" "$W_NEW_PASSWORD")"
)"

if [[ "$W_NEW_LOGIN_HTTP" != "201" ]]; then
  cat "$LOG_DIR/w-new-login.json"
  fail "New password did not sign in (recovery incomplete). HTTP $W_NEW_LOGIN_HTTP"
fi

echo "✓ Old password rejected; new password signs in — recovery complete"

echo
echo "[W8/8] The link is single-use; unknown tokens die the same way..."

W_REPLAY_HTTP="$(
  curl -sS -o "$LOG_DIR/w-replay.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/reset-password" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$W_RESET_TOKEN\",\"password\":\"Another-Pass-000\"}"
)"

if [[ "$W_REPLAY_HTTP" != "400" ]]; then
  cat "$LOG_DIR/w-replay.json"
  fail "Burned reset link was accepted again. HTTP $W_REPLAY_HTTP"
fi

W_BOGUS_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"

W_BOGUS_HTTP="$(
  curl -sS -o "$LOG_DIR/w-bogus.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/reset-password" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$W_BOGUS_TOKEN\",\"password\":\"Another-Pass-000\"}"
)"

if [[ "$W_BOGUS_HTTP" != "400" ]]; then
  cat "$LOG_DIR/w-bogus.json"
  fail "Unknown reset token was not rejected. HTTP $W_BOGUS_HTTP"
fi

# Replay and unknown-token probing must be indistinguishable, so the endpoint
# cannot be used to test whether a token exists.
python3 - "$LOG_DIR/w-replay.json" "$LOG_DIR/w-bogus.json" <<'PYJSON'
import json, sys
replay = json.load(open(sys.argv[1], encoding="utf-8"))
bogus = json.load(open(sys.argv[2], encoding="utf-8"))
if replay.get("message") != bogus.get("message"):
    raise SystemExit(
        "ERROR: dead-link errors differ — token probing oracle: "
        + json.dumps([replay, bogus])[:400]
    )
if "invalid or has expired" not in (replay.get("message") or ""):
    raise SystemExit("ERROR: unexpected dead-link message: " + json.dumps(replay)[:400])
print("✓ Burned and unknown links fail with one generic message")
PYJSON

echo "✓ Single-use link enforced; no token-probing oracle"

echo
echo "✓ ACCOUNT RECOVERY FLOW ACCEPTANCE PASSED"

echo
echo "RATE LIMITING FLOW"
echo "========================================"

# CP13: auth/* and public reads are rate limited by ThrottlerGuard. Section L
# runs near the end on purpose — hammering login exhausts the shared per-IP
# login bucket. L3 sleeps out the window and proves recovery, so the sections
# after it (Q, M) start with a fresh bucket; Q spends only two logins from it.

echo
echo "[L1/3] A login burst gets blocked with 429..."

L_TS="$(date +%s)"
L_EMAIL="cp13_limit_$L_TS@bonagri.local"
L_THROTTLED=""

for L_I in $(seq 1 16); do
  L_HTTP="$(
    curl -sS -o "$LOG_DIR/l-login-$L_I.json" -w "%{http_code}" \
      -X POST "$API_URL$API_PREFIX/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$L_EMAIL\",\"password\":\"wrong-password-1\"}"
  )"

  if [[ "$L_HTTP" == "429" ]]; then
    L_THROTTLED="yes"
    break
  fi
done

if [[ -z "$L_THROTTLED" ]]; then
  fail "Login was never rate limited — 16 attempts from one IP, no 429"
fi

echo "✓ Login throttled with 429 on attempt $L_I/16"

echo
echo "[L2/3] Throttling is scoped — other routes keep serving..."

L_HEALTH_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" "$API_URL$API_PREFIX/health"
)"

if [[ "$L_HEALTH_HTTP" != "200" ]]; then
  fail "Health route broke during throttle. HTTP $L_HEALTH_HTTP"
fi

L_CATALOG_HTTP="$(
  curl -sS -o /dev/null -w "%{http_code}" "$API_URL$API_PREFIX/products"
)"

if [[ "$L_CATALOG_HTTP" != "200" ]]; then
  fail "Public catalog broke during throttle. HTTP $L_CATALOG_HTTP"
fi

echo "✓ Health and public catalog still return 200 while login is throttled"

echo
echo "[L3/3] The throttle window expires — a real login recovers..."

sleep 65

L_RECOVER_HTTP="$(
  curl -sS -o "$LOG_DIR/l-recover.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$SUPPLIER_EMAIL\",\"password\":\"$SUPPLIER_PASSWORD\"}"
)"

if [[ "$L_RECOVER_HTTP" != "201" ]]; then
  cat "$LOG_DIR/l-recover.json"
  fail "Login did not recover after the 60s throttle window. HTTP $L_RECOVER_HTTP"
fi

echo "✓ Legitimate login works again once the window resets (no restart needed)"

echo
echo "✓ RATE LIMITING FLOW ACCEPTANCE PASSED"

echo
echo "REFRESH SESSION HARDENING (HP5)"
echo "========================================"

# HP5 (G5): login mints an HttpOnly rotating refresh cookie, POST
# /auth/refresh rotates it (a replayed cookie kills the whole family),
# POST /auth/logout revokes the session server-side, and the access token
# now lives only 15 minutes. curl refuses to send Secure cookies over
# http://localhost, so the cookie is handed back via -H "Cookie: …" — the
# same bytes a browser would attach.

echo
echo "[Q1/5] Login sets the refresh cookie and a 15-minute access token..."

Q_LOGIN_HEADERS="$LOG_DIR/q-login-headers.txt"
Q_LOGIN_HTTP="$(
  curl -sS -D "$Q_LOGIN_HEADERS" -o "$LOG_DIR/q-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$W_EMAIL\",\"password\":\"$W_NEW_PASSWORD\",\"rememberMe\":true}"
)"

if [[ "$Q_LOGIN_HTTP" != "201" ]]; then
  cat "$LOG_DIR/q-login.json"
  fail "HP5 baseline login failed. HTTP $Q_LOGIN_HTTP"
fi

Q_SET_COOKIE="$(
  grep -i '^set-cookie:' "$Q_LOGIN_HEADERS" | grep 'refresh_token=' | head -1 || true
)"

if [[ -z "$Q_SET_COOKIE" ]]; then
  cat "$Q_LOGIN_HEADERS"
  fail "Login did not set the refresh_token cookie"
fi

for Q_ATTR in "HttpOnly" "SameSite=Lax" "Secure" "Path=/api/auth" "Max-Age=2592000"; do
  if [[ "$Q_SET_COOKIE" != *"$Q_ATTR"* ]]; then
    fail "Refresh cookie is missing $Q_ATTR — got: $Q_SET_COOKIE"
  fi
done

Q_RAW1="${Q_SET_COOKIE#*refresh_token=}"
Q_RAW1="${Q_RAW1%%;*}"

if [[ -z "$Q_RAW1" || "$Q_RAW1" == *" "* ]]; then
  fail "Could not parse the raw refresh token out of: $Q_SET_COOKIE"
fi

Q_ACCESS_TOKEN="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["accessToken"])' \
    "$LOG_DIR/q-login.json"
)"

Q_TTL="$(
  python3 -c '
import base64, json, sys
payload = sys.argv[1].split(".")[1]
payload += "=" * (-len(payload) % 4)
data = json.loads(base64.urlsafe_b64decode(payload))
print(data["exp"] - data["iat"])
' "$Q_ACCESS_TOKEN"
)"

if [[ "$Q_TTL" != "900" ]]; then
  fail "Access token TTL must be 900s (15 min, HP5) — got ${Q_TTL}s"
fi

echo "✓ Cookie HttpOnly; SameSite=Lax; Secure; Path=/api/auth; Max-Age=30d; JWT TTL=${Q_TTL}s"

echo
echo "[Q2/5] /auth/refresh rotates the cookie and mints a new access token..."

# JWTs carry a second-granularity iat: if login and refresh land in the same
# wall-clock second, the "fresh" token is byte-identical to the login token
# and the inequality check below false-fails (hit on 2026-11-18 when a fast
# run finished Q1→Q2 inside one second). A 1s gap guarantees a different iat.
sleep 1

Q_REFRESH_HEADERS="$LOG_DIR/q-refresh-headers.txt"
Q_REFRESH_HTTP="$(
  curl -sS -D "$Q_REFRESH_HEADERS" -o "$LOG_DIR/q-refresh.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/refresh" \
    -H "Cookie: refresh_token=$Q_RAW1"
)"

if [[ "$Q_REFRESH_HTTP" != "200" ]]; then
  cat "$LOG_DIR/q-refresh.json"
  fail "refresh must answer 200 with a rotated session. HTTP $Q_REFRESH_HTTP"
fi

Q_SET_COOKIE2="$(
  grep -i '^set-cookie:' "$Q_REFRESH_HEADERS" | grep 'refresh_token=' | head -1 || true
)"
Q_RAW2="${Q_SET_COOKIE2#*refresh_token=}"
Q_RAW2="${Q_RAW2%%;*}"

if [[ -z "$Q_RAW2" || "$Q_RAW2" == "$Q_RAW1" ]]; then
  fail "refresh did not rotate the cookie (old='$Q_RAW1' new='$Q_RAW2')"
fi

Q_REFRESH_ACCESS="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["accessToken"])' \
    "$LOG_DIR/q-refresh.json"
)"

if [[ -z "$Q_REFRESH_ACCESS" || "$Q_REFRESH_ACCESS" == "$Q_ACCESS_TOKEN" ]]; then
  fail "refresh did not mint a fresh access token"
fi

echo "✓ Cookie rotated; fresh access token returned; body keeps {accessToken, user}"

echo
echo "[Q3/5] Replaying the OLD cookie revokes the whole family..."

Q_REPLAY_HTTP="$(
  curl -sS -o "$LOG_DIR/q-replay.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/refresh" \
    -H "Cookie: refresh_token=$Q_RAW1"
)"

if [[ "$Q_REPLAY_HTTP" != "401" ]]; then
  cat "$LOG_DIR/q-replay.json"
  fail "Replayed refresh cookie must be rejected with 401. HTTP $Q_REPLAY_HTTP"
fi

# Theft response kills the CURRENT leaf too: the victim's live cookie
# (Q_RAW2) must be dead from that moment on.
Q_FAMILY_HTTP="$(
  curl -sS -o "$LOG_DIR/q-family.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/refresh" \
    -H "Cookie: refresh_token=$Q_RAW2"
)"

if [[ "$Q_FAMILY_HTTP" != "401" ]]; then
  cat "$LOG_DIR/q-family.json"
  fail "Reuse detection must revoke the family — live cookie answered HTTP $Q_FAMILY_HTTP"
fi

echo "✓ Replayed cookie 401s and the family (including the current leaf) is revoked"

echo
echo "[Q4/5] Logout revokes the session server-side and clears the cookie..."

Q_LOGIN2_HEADERS="$LOG_DIR/q-login2-headers.txt"
Q_LOGIN2_HTTP="$(
  curl -sS -D "$Q_LOGIN2_HEADERS" -o "$LOG_DIR/q-login2.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$W_EMAIL\",\"password\":\"$W_NEW_PASSWORD\"}"
)"

if [[ "$Q_LOGIN2_HTTP" != "201" ]]; then
  cat "$LOG_DIR/q-login2.json"
  fail "Second HP5 login failed. HTTP $Q_LOGIN2_HTTP"
fi

Q_SET_COOKIE3="$(
  grep -i '^set-cookie:' "$Q_LOGIN2_HEADERS" | grep 'refresh_token=' | head -1 || true
)"
Q_RAW3="${Q_SET_COOKIE3#*refresh_token=}"
Q_RAW3="${Q_RAW3%%;*}"

if [[ -z "$Q_RAW3" || "$Q_RAW3" == *" "* ]]; then
  fail "Second login did not yield a parseable refresh cookie"
fi

Q_LOGOUT_HEADERS="$LOG_DIR/q-logout-headers.txt"
Q_LOGOUT_HTTP="$(
  curl -sS -D "$Q_LOGOUT_HEADERS" -o "$LOG_DIR/q-logout.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/logout" \
    -H "Cookie: refresh_token=$Q_RAW3"
)"

if [[ "$Q_LOGOUT_HTTP" != "200" ]]; then
  cat "$LOG_DIR/q-logout.json"
  fail "logout must answer 200. HTTP $Q_LOGOUT_HTTP"
fi

if ! grep -qi '^set-cookie:.*refresh_token=;.*Max-Age=0' "$Q_LOGOUT_HEADERS"; then
  cat "$Q_LOGOUT_HEADERS"
  fail "logout must clear the cookie with an expired refresh_token"
fi

Q_AFTER_LOGOUT="$(
  curl -sS -o "$LOG_DIR/q-after-logout.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/refresh" \
    -H "Cookie: refresh_token=$Q_RAW3"
)"

if [[ "$Q_AFTER_LOGOUT" != "401" ]]; then
  cat "$LOG_DIR/q-after-logout.json"
  fail "The logged-out cookie must be dead server-side. HTTP $Q_AFTER_LOGOUT"
fi

echo "✓ Cookie cleared (Max-Age=0) and the revoked session cannot refresh"

echo
echo "[Q5/5] Refresh is cookie-only — no cookie, no session..."

Q_NO_COOKIE="$(
  curl -sS -o "$LOG_DIR/q-nocookie.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/refresh"
)"
Q_BOGUS="$(
  curl -sS -o "$LOG_DIR/q-bogus.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/refresh" \
    -H "Cookie: refresh_token=not-a-real-token"
)"

if [[ "$Q_NO_COOKIE" != "401" ]]; then
  fail "refresh without a cookie answered HTTP $Q_NO_COOKIE (want 401)"
fi

if [[ "$Q_BOGUS" != "401" ]]; then
  fail "refresh with a bogus cookie answered HTTP $Q_BOGUS (want 401)"
fi

echo "✓ Missing and unknown cookies are rejected with 401"

echo
echo "✓ REFRESH SESSION HARDENING ACCEPTANCE PASSED"

echo
echo "MOBILE APP ROUTES (HOME / EXPLORE / CART / PROFILE)"
echo "========================================"

echo "[M1/2] The buyer app routes render..."

MOBILE_HOME_CODE="$(
  curl -sS -m 90 -o "$LOG_DIR/mobile-home.html" -w "%{http_code}" \
    "$WEB_URL/")"

if [[ "$MOBILE_HOME_CODE" != "200" ]]; then
  fail "Mobile route / returned HTTP $MOBILE_HOME_CODE"
fi

# Guests (and crawlers) must keep the marketing hero on "/".
if ! grep -q "Agricultural trade" "$LOG_DIR/mobile-home.html"; then
  fail "Guest home no longer renders the marketing hero"
fi

echo "✓ Mobile route / -> 200 with the guest marketing hero"

for MOBILE_ROUTE in "/explore" "/cart" "/profile"; do
  MOBILE_ROUTE_FILE="$LOG_DIR/mobile-route.html"
  MOBILE_ROUTE_CODE="$(
    curl -sS -m 90 -o "$MOBILE_ROUTE_FILE" -w "%{http_code}" \
      "$WEB_URL$MOBILE_ROUTE")"

  if [[ "$MOBILE_ROUTE_CODE" != "200" ]]; then
    fail "Mobile route $MOBILE_ROUTE returned HTTP $MOBILE_ROUTE_CODE"
  fi

  if ! grep -q "Checking your BonAgri session" "$MOBILE_ROUTE_FILE"; then
    fail "Mobile route $MOBILE_ROUTE is not behind the buyer session guard"
  fi

  echo "✓ Mobile route $MOBILE_ROUTE -> 200 (buyer-guarded shell)"
done

echo
echo "[M2/2] The explore route honours the category query parameter..."

MOBILE_CAT_CODE="$(
  curl -sS -m 90 -o "$LOG_DIR/mobile-route.html" -w "%{http_code}" \
    "$WEB_URL/explore?cat=Fruits")"

if [[ "$MOBILE_CAT_CODE" != "200" ]]; then
  fail "Mobile route /explore?cat=Fruits returned HTTP $MOBILE_CAT_CODE"
fi

echo "✓ Mobile route /explore?cat=Fruits -> 200"

echo
echo "✓ MOBILE APP ROUTES ACCEPTANCE PASSED"

echo
echo "==============================================="
echo "[X1/5] Web response security headers (HP6 G6)"
echo "==============================================="

# HP6: next.config headers() must ship the TIGHTENED (enforcing) CSP — the
# plan starts report-only, flips after a green browser pass, and this suite
# only ever asserts the shipped state.

x_expect() {
  # x_expect <file> <extended-regex> <description> — pattern must be PRESENT
  if ! grep -Eiq "$2" "$1"; then
    cat "$1"
    fail "HP6 headers: missing $3"
  fi
}

x_reject() {
  # x_reject <file> <extended-regex> <description> — pattern must be ABSENT
  if grep -Eiq "$2" "$1"; then
    cat "$1"
    fail "HP6 headers: $3"
  fi
}

X_WEB_FILE="$LOG_DIR/x-web-headers.txt"
curl -sS -o /dev/null -D - "$WEB_URL/" >"$X_WEB_FILE"

x_expect "$X_WEB_FILE" "^content-security-policy:" \
  "web CSP must be enforced (report-only flipped after the browser pass)"
x_reject "$X_WEB_FILE" "^content-security-policy-report-only:" \
  "web must not still be report-only"
x_expect "$X_WEB_FILE" "frame-ancestors 'none'" "web CSP frame-ancestors"
x_expect "$X_WEB_FILE" "res\\.cloudinary\\.com" "web CSP Cloudinary img allowance"
x_expect "$X_WEB_FILE" "^x-frame-options: *deny" "web X-Frame-Options DENY"
x_expect "$X_WEB_FILE" "^x-content-type-options: *nosniff" "web nosniff"
x_expect "$X_WEB_FILE" "^referrer-policy: *strict-origin-when-cross-origin" \
  "web Referrer-Policy"
x_expect "$X_WEB_FILE" "^permissions-policy:.*geolocation=\\(self\\)" \
  "web Permissions-Policy geolocation=(self)"
x_expect "$X_WEB_FILE" "^strict-transport-security: *max-age=15552000" "web HSTS"
echo "✓ web serves enforced CSP, HSTS, XFO, nosniff, Referrer-Policy, Permissions-Policy"

echo
echo "[X2/5] API helmet headers (health stays unthrottled)..."

X_API_FILE="$LOG_DIR/x-api-headers.txt"
curl -sS -o /dev/null -D - "$API_URL$API_PREFIX/health" >"$X_API_FILE"

x_expect "$X_API_FILE" "^x-content-type-options: *nosniff" "API nosniff"
x_expect "$X_API_FILE" "^x-frame-options: *deny" "API X-Frame-Options DENY"
x_expect "$X_API_FILE" "^content-security-policy:.*frame-ancestors 'none'" \
  "API CSP frame-ancestors"
x_expect "$X_API_FILE" "^strict-transport-security: *max-age=15552000" "API HSTS"
x_expect "$X_API_FILE" "^referrer-policy: *strict-origin-when-cross-origin" \
  "API Referrer-Policy"
x_reject "$X_API_FILE" "^x-powered-by:" "API must not advertise X-Powered-By"
echo "✓ API helmet headers present (X-Powered-By stripped)"

echo
echo "[X3/5] CORS echoes the allowlisted web origin with credentials..."

X_CORS_ALLOWED="$LOG_DIR/x-cors-allowed.txt"
curl -sS -o /dev/null -D - -H "Origin: $WEB_URL" "$API_URL$API_PREFIX/health" \
  >"$X_CORS_ALLOWED"

X_ACO="$(
  grep -i '^access-control-allow-origin:' "$X_CORS_ALLOWED" |
    tr -d '\r' | awk '{print $2}'
)"
if [ "$X_ACO" != "$WEB_URL" ]; then
  cat "$X_CORS_ALLOWED"
  fail "HP6 CORS: expected Allow-Origin '$WEB_URL', got '$X_ACO'"
fi

if ! grep -qi '^access-control-allow-credentials: *true' "$X_CORS_ALLOWED"; then
  cat "$X_CORS_ALLOWED"
  fail "HP6 CORS: credentialed allowlisted origin must get Allow-Credentials: true"
fi
echo "✓ Allow-Origin echoes $WEB_URL with credentials"

echo
echo "[X4/5] CORS rejects a foreign origin (HP6 exit criterion)..."

X_CORS_FOREIGN="$LOG_DIR/x-cors-foreign.txt"
curl -sS -o /dev/null -D - -H "Origin: https://evil.example" \
  "$API_URL$API_PREFIX/health" >"$X_CORS_FOREIGN"
x_reject "$X_CORS_FOREIGN" "^access-control-allow-origin:" \
  "foreign origin must not receive Allow-Origin on a simple request"
echo "✓ simple request: no Allow-Origin for https://evil.example"

X_CORS_FOREIGN_PREFLIGHT="$LOG_DIR/x-cors-foreign-preflight.txt"
curl -sS -o /dev/null -D - -X OPTIONS \
  -H "Origin: https://evil.example" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization" \
  "$API_URL$API_PREFIX/health" >"$X_CORS_FOREIGN_PREFLIGHT"
x_reject "$X_CORS_FOREIGN_PREFLIGHT" "^access-control-allow-origin:" \
  "foreign origin must not pass preflight"
echo "✓ preflight: no Allow-Origin for https://evil.example"

X_CORS_PREFLIGHT="$LOG_DIR/x-cors-preflight.txt"
curl -sS -o /dev/null -D - -X OPTIONS \
  -H "Origin: $WEB_URL" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization" \
  "$API_URL$API_PREFIX/health" >"$X_CORS_PREFLIGHT"
x_expect "$X_CORS_PREFLIGHT" "^access-control-allow-origin:" \
  "allowlisted preflight must echo Allow-Origin"
x_expect "$X_CORS_PREFLIGHT" "^access-control-allow-methods:" \
  "allowlisted preflight must list Allow-Methods"
echo "✓ preflight allowed for $WEB_URL"

echo
echo "[X5/5] Health stays unthrottled (CP13)..."

for i in $(seq 1 15); do
  X_HEALTH_CODE="$(
    curl -sS -o /dev/null -w '%{http_code}' "$API_URL$API_PREFIX/health"
  )"
  if [ "$X_HEALTH_CODE" != "200" ]; then
    fail "HP6: /health must stay unthrottled — attempt $i answered HTTP $X_HEALTH_CODE"
  fi
done
echo "✓ health answered 15/15 rapid requests with 200 (unthrottled)"

echo
echo "✓ SECURITY HEADERS & CORS ACCEPTANCE PASSED"

echo
echo "RUNTIME SMOKE TEST CLEANUP"
echo "========================================"

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT

