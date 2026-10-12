#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="$ROOT/api"
WEB="$ROOT/web"

echo "========================================"
echo " BONAGRI AUTOMATED HARDEN + VERIFY"
echo "========================================"

cd "$ROOT"

echo
echo "[1/7] Repository..."
git status --short

echo
echo "[2/7] Order-status implementation..."
cd "$API"

grep -n -A45 -B15 'next === "CANCELLED"' \
  src/orders/orders.service.ts || true

echo
grep -n -A35 'const allowedTransitions' \
  src/orders/orders.service.ts

echo
echo "[3/7] Checking cancellation inventory protection..."

if grep -q 'const release = await tx.inventory.updateMany' \
  src/orders/orders.service.ts; then
  echo "✓ Conditional reservation release is present."
else
  echo "⚠ Conditional reservation release is missing."
  echo "Applying automated patch..."

  python3 - <<'PY'
from pathlib import Path

p = Path("src/orders/orders.service.ts")
s = p.read_text()

old = '''          await tx.inventory.update({
            where: {
              productId: item.productId,
            },
            data: {
              reservedQuantity: {
                decrement: item.quantity,
              },
            },
          });'''

new = '''          const release = await tx.inventory.updateMany({
            where: {
              productId: item.productId,
              reservedQuantity: {
                gte: item.quantity,
              },
            },
            data: {
              reservedQuantity: {
                decrement: item.quantity,
              },
            },
          });

          if (release.count !== 1) {
            throw new BadRequestException(
              `Reserved inventory is insufficient to release ${item.productName}`,
            );
          }'''

if old not in s:
    raise SystemExit(
        "ERROR: cancellation inventory block was not found; "
        "no unsafe automatic replacement performed."
    )

p.write_text(s.replace(old, new, 1))
print("✓ Cancellation inventory release hardened.")
PY
fi

echo
echo "[4/7] API TypeScript..."
npx tsc --noEmit --pretty false
echo "✓ API TypeScript passed."

echo
echo "[5/7] Frontend lint..."
cd "$WEB"
npm run lint
echo "✓ Frontend lint passed."

echo
echo "[6/7] Frontend TypeScript..."
npx tsc --noEmit --pretty false
echo "✓ Frontend TypeScript passed."

echo
echo "[7/7] Production build..."
npm run build
echo "✓ Production build passed."

echo
echo "========================================"
echo " BONAGRI AUTOMATION COMPLETE"
echo "========================================"

cd "$ROOT"

echo
echo "Final repository status:"
git status --short
