#!/bin/zsh
set -e

ROOT="$HOME/bonagri"
API="$ROOT/api"
WEB="$ROOT/web"

echo "========================================"
echo " BONAGRI FINAL INTEGRITY CHECK"
echo "========================================"

cd "$ROOT"

echo
echo "[1/6] Checking escaped URL literals..."
if grep -RFn 'http\://' api/src web/app web/lib 2>/dev/null; then
  echo "ERROR: Escaped http:// literal found."
  exit 1
fi
echo "✓ No escaped http:// literals"

echo
echo "[2/6] Checking API TypeScript..."
cd "$API"
npx tsc --noEmit --pretty false
echo "✓ API TypeScript passed"

echo
echo "[3/6] Checking frontend lint..."
cd "$WEB"
npm run lint
echo "✓ Frontend lint passed"

echo
echo "[4/6] Checking frontend TypeScript..."
npx tsc --noEmit --pretty false
echo "✓ Frontend TypeScript passed"

echo
echo "[5/6] Production build..."
npm run build
echo "✓ Production build passed"

echo
echo "[6/6] Final repository status..."
cd "$ROOT"
git status --short

echo
echo "========================================"
echo " FINAL INTEGRITY CHECK PASSED"
echo "========================================"
