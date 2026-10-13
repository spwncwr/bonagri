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
DISPUTE_CAPTURE_FILE="$ROOT/.e2e/dispute-resolution.txt"
NOTIFY_CAPTURE_FILE="$ROOT/.e2e/notifications.txt"
mkdir -p "$ROOT/.e2e"
rm -f "$CAPTURE_FILE"
rm -f "$DISPUTE_CAPTURE_FILE"
rm -f "$NOTIFY_CAPTURE_FILE"

E2E_CAPTURE_MAIL=true \
E2E_MAIL_CAPTURE_FILE="$CAPTURE_FILE" \
E2E_DISPUTE_CAPTURE_FILE="$DISPUTE_CAPTURE_FILE" \
E2E_NOTIFY_CAPTURE_FILE="$NOTIFY_CAPTURE_FILE" \
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

ADMIN_LOGIN_E_HTTP="$(
  curl -sS -o "$LOG_DIR/dispute-admin-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$ADMIN_E2E_EMAIL" "$ADMIN_E2E_PASSWORD")"
)"

if [[ "$ADMIN_LOGIN_E_HTTP" != "201" ]]; then
  cat "$LOG_DIR/dispute-admin-login.json"
  fail "Admin login for the dispute flow failed. HTTP $ADMIN_LOGIN_E_HTTP"
fi

ADMIN_TOKEN="$(
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("accessToken",""))' "$LOG_DIR/dispute-admin-login.json"
)"

if [[ -z "$ADMIN_TOKEN" ]]; then
  fail "Admin login for the dispute flow returned no access token"
fi

echo "✓ Admin login succeeded"

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
echo "✓ PRODUCT REQUESTS FLOW ACCEPTANCE PASSED"

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

ADMIN_LOGIN_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-login.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/auth/login" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$ADMIN_E2E_EMAIL" "$ADMIN_E2E_PASSWORD")"
)"

if [[ "$ADMIN_LOGIN_HTTP" != "201" ]]; then
  cat "$LOG_DIR/admin-login.json"
  fail "Admin login failed (check SEED_ADMIN_* env and that the seed ran). HTTP $ADMIN_LOGIN_HTTP"
fi

ADMIN_TOKEN="$(
  python3 -c '
import json,sys
with open(sys.argv[1]) as f:
    data=json.load(f)
print(data.get("accessToken",""))
' "$LOG_DIR/admin-login.json"
)"

if [ -z "$ADMIN_TOKEN" ]; then
  fail "Admin login returned no access token"
fi

echo "✓ Admin login succeeded"

request GET "$API_URL$API_PREFIX/admin/stats" "" "$ADMIN_TOKEN" > "$LOG_DIR/admin-stats.json"

python3 - "$LOG_DIR/admin-stats.json" <<'PYJSON'
import json, sys

stats = json.load(open(sys.argv[1], encoding="utf-8"))

if stats.get("users", {}).get("total", 0) < 3:
    raise SystemExit("ERROR: expected at least 3 users in platform stats")

if stats.get("products", {}).get("total", 0) < 1:
    raise SystemExit("ERROR: expected at least 1 product in platform stats")

print("✓ Platform stats: {} users, {} products, {} orders".format(
    stats["users"]["total"], stats["products"]["total"], stats["orders"]["total"]))
PYJSON

echo
echo "[A2/3] Promote buyer -> supplier, suspend -> reactivate..."

PROMOTE_HTTP="$(
  curl -sS -o "$LOG_DIR/admin-promote.json" -w "%{http_code}" \
    -X POST "$API_URL$API_PREFIX/admin/users/$USER_ID/promote-supplier" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
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
echo "RUNTIME SMOKE TEST CLEANUP"
echo "========================================"

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT

