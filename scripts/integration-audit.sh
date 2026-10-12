#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="$ROOT/api"
WEB="$ROOT/web"

echo "========================================"
echo " BONAGRI INTEGRATION AUDIT"
echo "========================================"

cd "$ROOT"

echo
echo "[1/8] Git diff summary..."
git diff --stat

echo
echo "[2/8] Auth endpoints..."
grep -RFn '@Post("register")' "$API/src/auth" || true
grep -RFn '@Post("login")' "$API/src/auth" || true
grep -RFn '@Post("verify-email")' "$API/src/auth" || true
grep -RFn '@Post("resend-verification")' "$API/src/auth" || true

echo
echo "[3/8] Order endpoints..."
grep -RFn '@Post()' "$API/src/orders" || true
grep -RFn '@Patch(":id/status")' "$API/src/orders" || true
grep -RFn 'getBuyerOrders' "$API/src/orders" || true
grep -RFn 'getSupplierOrders' "$API/src/orders" || true

echo
echo "[4/8] Inventory protection..."
grep -n -A18 -B5 'const release = await tx.inventory.updateMany' \
  "$API/src/orders/orders.service.ts"

echo
echo "[5/8] Order transition map..."
grep -n -A12 'const allowedTransitions' \
  "$API/src/orders/orders.service.ts"

echo
echo "[6/8] API TypeScript..."
cd "$API"
npx tsc --noEmit --pretty false
echo "✓ API TypeScript passed."

echo
echo "[7/8] Frontend..."
cd "$WEB"
npm run lint
npx tsc --noEmit --pretty false
echo "✓ Frontend lint + TypeScript passed."

echo
echo "[8/8] Production build..."
npm run build
echo "✓ Production build passed."

echo
echo "========================================"
echo " INTEGRATION AUDIT COMPLETE"
echo "========================================"

cd "$ROOT"

echo
echo "Changed files:"
git status --short
