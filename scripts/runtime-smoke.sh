#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ROOT="$REPO_ROOT"
API="$ROOT/api"
WEB="$ROOT/web"

API_URL="${API_URL:-http://localhost:3000}"
WEB_URL="${WEB_URL:-http://localhost:3001}"
API_PREFIX="${API_PREFIX:-/api}"

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

echo
echo "[2/12] Starting API..."
cd "$API"

CAPTURE_FILE="$ROOT/.e2e/verification-url.txt"
mkdir -p "$ROOT/.e2e"
rm -f "$CAPTURE_FILE"

E2E_CAPTURE_MAIL=true \
E2E_MAIL_CAPTURE_FILE="$CAPTURE_FILE" \
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

product = active[0]
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
echo "RUNTIME SMOKE TEST CLEANUP"
echo "========================================"

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT

