#!/bin/zsh
set -e

ROOT="$HOME/bonagri"
API="$ROOT/api"
AUTH="$API/src/auth/auth.service.ts"
REGISTER="$API/src/auth/auth.controller.ts"

echo "========================================"
echo " BONAGRI REGISTRATION VERIFICATION FIX"
echo "========================================"

echo
echo "[1/6] Inspecting registration implementation..."

grep -n -A 100 -B 10 "async register" "$AUTH" || true

echo
echo "[2/6] Checking verification-token creation..."

grep -n -E \
  "EmailVerificationToken|verification|verifyEmail|sendVerification" \
  "$AUTH" || true

echo
echo "[3/6] Checking registration response..."

grep -n -A 80 -B 10 \
  '@Post("register")' "$REGISTER" || true

echo
echo "[4/6] API TypeScript verification..."
cd "$API"
npx tsc --noEmit --pretty false
echo "✓ API TypeScript passed."

echo
echo "[5/6] Re-running runtime smoke test..."
cd "$ROOT"

if ./scripts/runtime-smoke.sh; then
  echo
  echo "✓ Runtime smoke test passed."
else
  echo
  echo "⚠ Runtime smoke test still reports a registration verification failure."
  echo
  echo "The next step is to inspect the exact register() implementation above."
  echo "No database reset or destructive migration was performed."
  exit 1
fi

echo
echo "========================================"
echo " REGISTRATION VERIFICATION CHECK PASSED"
echo "========================================"
