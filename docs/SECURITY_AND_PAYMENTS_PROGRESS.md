# BonAgri — Security & Payments Progress (Checkpoint Register)

Companion document: `docs/SECURITY_AND_PAYMENTS_PLAN.md` (phases, decisions D1–D6).
Gates reference: `docs/CHECKPOINT_PLAN.md` §1 (universal gates).

**How to use this file**: after finishing each phase, update its row in §2
(`pending` → `done (commit)` + date) and fill in its §3 entry (what actually
shipped, gate numbers, live evidence, deviations). Never start phase N+1 with
phase N's row still `pending` — the register is the source of truth for where
work stands.

## 1. Universal gates (every checkpoint, in order)

```bash
# 1. API
cd api && npm run build && npm test && npm run lint

# 2. Web
cd web && npm run build && npm run lint && npm test

# 3. Schema changes only: regenerate + commit the client, new migration
cd api && npx prisma migrate dev --name <name>
git add api/src/generated/prisma prisma/migrations

# 4. Runtime acceptance (local dev DB; extend the smoke section for the phase)
bash scripts/runtime-smoke.sh

# 5. Commit + push — Conventional Commits, lowercase, imperative

# 6. Live verification against the deployed stack
curl -s https://bonagri-api.onrender.com/api/health   # database: connected
# + the phase's journey walkthrough on https://bonagri-web.onrender.com

# 7. Update THIS document (§2 row + §3 entry) before moving on
```

Baseline at plan time: **api 453 tests, web 81 tests** (re-verify each phase;
record actuals in §3).

## 2. Checkpoint register

| ID | Phase | Date | Status |
|---|---|---|---|
| HP1 | Buyer payment-method selection screen | 2026-11-14 | done (3ede15d, 2026-11-14) |
| HP2 | Admin 2FA (mandatory TOTP) + sign-in alerts | 2026-11-15 | done (518cf66, 2026-11-15) |
| HP3 | Step-up confirmation + admin audit trail | 2026-11-15 | done (9012021, 2026-11-16) |
| HP4 | Password reset / account recovery | 2026-11-16 | done (a04d649, 2026-11-17) |
| HP5 | Session hardening (refresh rotation, no storage token) | — | pending |
| HP6 | Security hygiene + admin runbook | — | pending |
| F1 | Quote → checkout (agreed price → payment screen) | — | pending |
| F2 | Order-scoped messaging (buyer/supplier/transporter) | — | pending |
| F3 | Payment-after-acceptance timing (optional) | — | pending |

Update the Status column (`pending` → `in progress` → `done (commit, date)`) as
work proceeds; a phase that stalls goes back to `pending` with a note in §3.
F-phases are product work added 2026-11-14 (plan §6); default order
**F1 → F2 → F3 after HP6** — reorder only by explicit user call.

## 3. Per-checkpoint log

Fill each entry when the phase lands. Template:

```
### HPn — <phase name>
**Status**: pending | in progress | done (<commit>, <date>)
**Shipped**: <what actually changed — schema/API/web, 3-6 bullets>
**Deviations from plan**: <none | what changed and why (cite plan decision)>
**Gates**: api build ✓/✗ · api lint ✓/✗ (notes) · api test <n> (<delta>) ·
  web build ✓/✗ · web lint ✓/✗ · web test <n> (<delta>) · smoke <section> <n> ✓/✗
**Live journey**: <deployed walkthrough evidence — key responses, UI states>
**Residue / follow-ups**: <leftovers, deferred items, known accepted issues>
```

---

### HP1 — Buyer payment-method selection screen
**Status**: done (3ede15d, 2026-11-14)
**Shipped**:
- `web/lib/payment-methods.ts` (new): method registry — `MANUAL_EFT` selectable,
  `PAYFAST`/`OZOW` honest "Coming soon" placeholders; `isSelectablePaymentMethod`
  guard rejects stale/unknown stored ids; `CHECKOUT_PAYMENT_METHOD_KEY` hand-off.
- `web/app/checkout/page.tsx`: "Payment method" card between the address picker
  and the per-supplier order preview; real radio for Manual EFT (default),
  `aria-disabled` tiles for the placeholders; sessionStorage persist on select
  **and** at place-time; success screen echoes `Payment method: Manual EFT`.
- `web/app/orders/[id]/page.tsx`: `checkoutMethod` read from the hand-off in the
  async loader; echo in the Payment section's no-payment branch (once a `Payment`
  row exists, CP11's "Manual EFT · …" line takes over).
- `web/tests/checkout-payment.test.mjs` (new, 4 source-assertion tests).
**Deviations from plan**: none (plan D1 — checkout API body unchanged, no
  migration; only one live method). One implementation bug found & fixed during
  the live journey: the default selection never fires `onChange`, so sessionStorage
  was never written — added a place-time `setItem(CHECKOUT_PAYMENT_METHOD_KEY, paymentMethod)`.
**Gates**: api build ✓ · api lint ✓ · api test 453 (unchanged, no api change) ·
  web build ✓ · web lint ✓ · web test 85 (+4) · smoke not run (no new endpoint;
  checkout API body untouched — smoke section unchanged)
**Live journey**: local dev stack (web :3001 / api :3000). Buyer login →
  `/checkout`: card at `Deliver to → Payment method → Your orders (1)`, radio
  `MANUAL_EFT` checked, 2 `aria-disabled` tiles with "Coming soon" badges; clicking
  both tiles leaves selection `MANUAL_EFT` (verified in DOM). Place order
  `BON-20261114-622918` (Fresh Tomatoes R18) without touching the radio → success
  screen echoes "Payment method: Manual EFT"; sessionStorage holds `MANUAL_EFT`;
  order detail `/orders/fec5d020…` Payment section echoes "Payment method: Manual
  EFT" above the EFT instructions. 0 console errors. Screenshot captured
  (payment card: EFT selected/green, Card + Instant EFT dashed "Coming soon").
**Residue / follow-ups**: PayFast/Ozow remain placeholders until a gateway phase;
  the checkout-time choice is not persisted server-side (per D1) — HP5/gateway
  work may revisit storing it on the order; two local test orders left in the dev
  DB (`BON-20261114-521092`, `BON-20261114-622918`) — acceptable residue, smoke
  not touched.

### HP2 — Admin 2FA (mandatory TOTP) + sign-in alerts
**Status**: done (518cf66, 2026-11-15)
**Shipped**:
- Migration `20261114052359_add_admin_2fa` + regenerated Prisma client:
  `twoFactorSecret/Enabled/EnabledAt/RecoveryCodes` on `User` plus single-use
  pre-auth columns `twoFactorPreAuthHash/Exp` (7 new User columns total).
- `api/src/auth/totp.ts` (new): dependency-free RFC 6238 TOTP — HMAC-SHA1,
  30s, 6 digits, ±1 step drift window, base32 secret gen; pinned by RFC 6238
  test vectors in `totp.spec.ts`.
- Auth service/controller: `POST /auth/2fa/{setup,enable,verify,disable}`
  (10/min each, `two-factor-setup.guard.ts` + 3 DTOs); pre-auth JWT on
  `sha256(JWT_SECRET + ":2fa-preauth")` with `jti`, 5-min TTL, single-use;
  ADMIN login never yields an access token pre-verification; enable issues 10
  recovery codes stored as SHA-256 hashes (single-use); disable accepts a TOTP
  code or a recovery code; `JwtAuthGuard` rejects pre-auth tokens on normal
  routes; `MailService.sendAdminLoginAlert` on every completed admin login.
- `web/app/login/page.tsx`: two-step login — password → 6-digit code with a
  "Use a recovery code instead" toggle → access token, or hand-off to
  `/admin/security` when enrolment is required.
- `web/app/admin/security/page.tsx` (new): enrolment wizard (QR via
  `qrcode.react@4.2.0` + manual key), codes-shown-once gate, ON status card,
  disable with password + code/recovery code, post-disable re-enrolment;
  `AuthGuard` `preAuthHandoff` mode; `saveAuth` clears the pre-auth token;
  Security nav entry.
- `scripts/runtime-smoke.sh` section **T** (T1–T6: enrol, verify, wrong code,
  recovery-code login, disable, re-enrol) + `admin_login`/`admin_totp`
  helpers caching `{secret, recoveryCodes}` in `.runtime-test/` (gitignored);
  `web/tests/admin-two-factor.test.mjs` (new, 7 tests).
**Deviations from plan**: smoke section is **T**, not the plan's N, and runs
before the rate-limit section L; T0 opens with `sleep 61` so the shared login
bucket (15/min per IP) has drained, and T3/T4 assert distinct HTTP statuses
(429 vs 401) instead of just failure. `User` gained 2 more columns than the
plan sketched (the pre-auth hash/exp pair). `AuthGuard` needed a third
`preAuthHandoff` mode for the enrolment hand-off. Three product bugs found &
fixed during the live journey: (1) login branch guard now tests
`"preAuthToken" in data` (the setup reply omits `twoFactorRequired`);
(2) `clearAuth()` before the pre-auth hand-off (a stale buyer token made
AuthGuard bounce enrolment to `/`); (3) `setupRequestRef` memoisation —
StrictMode's dev double-invoke POSTed `/2fa/setup` twice and could desync the
displayed QR from the stored secret (every code would then be rejected); only
the post-disable re-enrol may mint a fresh secret directly. One journey-only
defect (not product): the injected TOTP used `sig[15]` as the truncation
offset — SHA-1 digests are 20 bytes, so the RFC offset byte is the *last*
digest byte (`sig[sig.length-1]`, as `totp.ts` and `admin_totp` both do);
the product code was correct throughout.
**Gates**: api build ✓ · api lint ✓ (4 warnings, 3 pre-existing) · api test
473 (+20: totp vectors + two-factor service/e2e suite) · web build ✓ ·
web lint ✓ · web test 92 (+7) · smoke `runtime-smoke.sh` exit 0, **21 flows**
(section T green, rate-limit intact after it)
**Live journey**: local dev stack (web :3001 / api :3000). Admin login →
enrolment wizard (exactly **1** `POST /2fa/setup` 201; DB secret verified
byte-identical to the displayed key) → TOTP enable **201** with in-page RFC
vector self-check passing → recovery-codes view (10 codes, shown once) →
tick → Continue → **"Two-factor authentication is ON"** → sign out → password
→ **2-step** code screen → recovery-code toggle (both directions) → fresh
TOTP **201** with access token → `/admin` dashboard. Screenshots shown for
every state; **0 console errors**. Sign-in alert email captured at
`.e2e/admin-login-alert.txt`. Recovery-codes state reconciled to
`.runtime-test/admin-2fa-state.json` (all 10 hashes verified against the DB).
**Residue / follow-ups**: Render/deployed-stack walkthrough for HP2 still
owed (HP1 note: re-check Render on HP2+); the seed admin is enrolled in the
dev DB — next smoke run consumes 1 of the 10 cached recovery codes (T6
asserts ≥9 remain); login rate-limit bucket stays shared per IP (accepted);
`.e2e/` + `.runtime-test/` artifacts stay gitignored.

### HP3 — Step-up confirmation + admin audit trail
**Status**: done (9012021, 2026-11-16)
**Shipped**: `AdminAuditLog` (+ migration `20261115170841_add_admin_audit_log`,
regenerated client committed) written in the **same transaction** as each
guarded mutation via `AdminAuditService.guarded`; `POST /auth/step-up`
(password-verified, 10/min, 5-min TTL, secret derived
`sha256(JWT_SECRET+":step-up")`, deliberately **not** single-use) with
`StepUpGuard` on **17** admin mutation routes (failures **403** +
`code:"STEP_UP_REQUIRED"`); `admin/verification/*` excluded (own trail per
plan D3). Read side: `GET /admin/audit` (actor/action filters, response also
returns the distinct `actions` list). Web: shared `StepUpProvider` mounted in
`/admin/layout.tsx` (inside AuthGuard, above AdminShell) — on 403+STEP_UP_REQUIRED
it silently retries with an in-memory token (ref only, expires 30s early) or
opens the password dialog (401/429 messages stay in the dialog; cancel returns
the original 403); token never persisted (test enforces no localStorage /
sessionStorage access); concurrent prompts share one waiter. **15** mutation
wraps across 7 pages (users 4, suppliers 1, transporters 1, categories 2,
banners 3, notifications 1, promotions 3); reads stay plain `fetch`;
security/verification/disputes/applications pages stay unwrapped (asserted).
New `/admin` nav entry **Audit** (`HistoryIcon`).
**Deviations from plan**: smoke section is **U**, not the plan's O — O1/8–O8/8
already belongs to CP16a's media flow (same N→T precedent as HP2); label
renames applied (`[O1/5..O5/5]→[U1/5..U5/5]`, `O_*→U_*`, `o-*.json→u-*.json`)
and the deviation is noted in the section comment. Guard failures are **403**
(not the plan's 428 — 428 Precondition Required is not a code the fetch layer
maps cleanly; 403 + machine `code` keeps the client check one branch). Extra
`[createdAt]` index on `AdminAuditLog` (feed sorts by time). `admin_step_up()`
smoke helper file-caches the token at `$LOG_DIR/admin-step-up.json` (refresh on
mtime > 4 min) — all 21 existing guarded mutation call sites now send
`-H "X-Step-Up: …"` (only `admin/verification/*` intentionally lack it).
Journey-only defect found & fixed in the live journey (web): after a failed
password the provider did `await requestPassword(message)` *and* the loop top
awaited a fresh waiter — the discarded await swallowed the next submitted
password and wedged the dialog at "Confirming..." forever (no POST ever left).
Fix: the error re-prompt is **not** awaited (the loop top awaits the same
waiter); the test now asserts `(?<!await )requestPassword\(message\);` +
`doesNotMatch(/await requestPassword\(message\)/)` so the regression cannot
return.
**Gates**: api build ✓ · api lint ✓ (4 pre-existing mail warnings) · api test
493 (+20: step-up service/guard specs + audit `guarded`/list service specs) ·
web build ✓ · web lint ✓ (1 pre-existing warning) · web test **100** (+8
`admin-step-up.test.mjs`: handshake contract, no-storage, throttle messages,
layout mount order, exact per-page wrap counts, exclusions, nav entry, audit
page) · smoke `runtime-smoke.sh` exit 0, section **U green U1/5–U5/5** (wrong
password 401 · missing header 403 STEP_UP_REQUIRED with no side effect ·
forged+expired rejected · valid step-up creates banner · `/admin/audit?action=BANNER_CREATE`
row with actor/target/metadata + filter · feed newest-first · token reuse ·
patch+delete under same step-up · `BANNER_DELETE` survives cleanup) with all
21 header edits green across A/P/NEAR/T/L/M.
**Live journey**: local dev stack (web :3001, api :3000 with mail capture).
Throwaway `hp3_journey_admin` (own constant password, never the `.env` seed
password) registered+verified via capture-file bridge → promoted ADMIN in DB →
login → mandatory enrolment (QR secret read from DOM, TOTP computed
client-side, **Enable 2FA** → recovery codes shown once → tick → Continue) →
`/admin/users` → Promote journey buyer to supplier → page confirm → **step-up
dialog** appeared (403 handshake) → wrong password → **"That password is not
correct."** stays in the dialog (screenshot) → correct password → dialog
closed → buyer row now **SUPPLIER** with profile "Journey Buyer Agri"
(network: two 401s → `POST /auth/step-up` **201** → replay succeeded) →
`/admin/audit` showed **USER PROMOTE SUPPLIER** row (actor
hp3_journey_admin, `16 Nov 2026, 06:02`, target `USER · 39949f6a…`, metadata
`to: SUPPLIER · from: BUYER`) → action filter narrowed to promote rows only
(banner rows dropped). **0 console errors** on the audit page. Screenshots
shown for 2FA enrolment + step-up dialog; remaining states DOM-verified (user
elected to skip captures when the desktop window was hidden).
**Residue / follow-ups**: journey fixture accounts + supplier profile deleted
after the journey (`AdminAuditLog.actor` cascade verified — 0 orphan rows),
capture files removed, dev servers stopped; HP3 Render/deployed-stack
walkthrough still owed with HP2's (HP1 note); headless capture dropped the
dialog's `backdrop-filter` layer, so the journey harness injected
`backdrop-filter: none` at runtime for the modal screenshots — product code
unchanged.

### HP4 — Password reset / account recovery
**Status**: done (a04d649, 2026-11-17)
**Shipped**: `PasswordResetToken` (+ migration `20261117061407_add_password_reset_token`,
regenerated client committed) — only the **SHA-256 hash** of the token is
persisted, 30-minute TTL, single-use. `POST /auth/forgot-password` always
answers **202** with one fixed body for known, unknown, unverified and
mail-failing addresses (SMTP errors are logged, never surfaced — a 500 only
for registered addresses would be a live enumeration oracle), budgeted
**5/min**; mints a link only for existing accounts and burns any outstanding
older link first. `POST /auth/reset-password` `{token, password}` →
**bcrypt 12** + token `usedAt` in **one `$transaction`**; unknown / expired /
reused links share one generic `BadRequestException` (400); `status` and
`emailVerifiedAt` are untouched, so a reset can never un-suspend an account or
verify an email (the SUSPENDED login gate keeps holding). Refresh-token revoke
deliberately **skipped with a comment** pointing at HP5 (plan's own escape
clause — no refresh tokens exist yet). DTO `Length(64)` rejects junk tokens
before the lookup. Mail: `sendPasswordResetEmail` with its own
`E2E_RESET_CAPTURE_FILE` bridge (pattern of the verification/OTP/dispute
mails). Web: `/forgot-password` (one field, repeats the API's generic
sentence verbatim; 429 → wait message; "Use a different email" resets the
form), `/reset-password` (token read from the link's query string inside
`Suspense` like `/verify-email`, password + confirm matching register's
`MinLength(8)` rules, client-side mismatch check, **passwords cleared from
state the moment the API accepts them**, dead link → "Request a new reset
link" state, success → sign-in CTA), "Forgot password?" link on `/login`'s
password step only (not the 2FA code step).
**Deviations from plan**: smoke section is **W**, not the plan's P — P1/4–P4/4
plus PICKS/NEAR already own P (same collision precedent as N→T, O→U); Q stays
reserved for HP5. Design note: forgot-password mints links for accounts in
**any** status (response identical either way, and reset never touches
`status`), so recovery is possible without weakening the login gates — recorded
here because the plan only specified the "reset must not bypass SUSPENDED"
half.
**Gates**: api build ✓ · api lint ✓ (4 pre-existing mail warnings, no new
ones) · api test **501** (+8: no-enumeration/generic-error/hash-swap/token-burn
unit specs + forgot 5-min and reset 10-min throttle pins) · web build ✓ (both
routes prerendered) · web lint ✓ (0 errors; 1 pre-existing warning + 16
warnings from the uncommitted `web/android/` Capacitor build output — flat-config
ESLint does not read `.eslintignore`, so `android/` gets linted; not HP4's
doing, left to the owner) · web test **105** (+5 `password-reset.test.mjs`:
generic answer verbatim, token only in URL+body with no storage access,
register-matching rules + clear-on-success, dead-link/missing-token states,
login link placement) · smoke `runtime-smoke.sh` exit 0, section **W green
W1/8–W8/8** (dedicated account → hash recorded → 202 + captured link →
unknown address returns byte-identical message with **no link minted** →
429 on request 6 of 5/min → hash swapped + all token rows burned → old
password 401 / new password 201 → replay + unknown token share one generic
400) with the rest of the suite (U, L, mobile) still green.
**Live journey**: local dev stack (web :3001, api :3000, mail capture bridged
to `$TMPDIR`). Throwaway `hp4_journey_*` buyer registered + verified via the
capture bridge → `/login` → **"Forgot password?"** link → forgot form →
submitted an **unknown address** first: identical generic confirmation
(screenshot) and the capture file confirmed **no link minted** → real address:
same confirmation, link captured → opened `/reset-password?token=…` as the
email would → mismatched passwords → **"Passwords do not match"** stays in the
form (screenshot) → valid pair → **"Password updated."** (network:
`POST /api/auth/reset-password`) → replayed the same link → **"This reset
link is invalid or has expired"** + Request a new reset link (screenshot) →
old password → **"Invalid email or password"** → new password → landed on the
marketplace logged in. Console: **0 error-level messages on the final
document**; the only error-level line during the whole journey was Chromium's
automatic `Failed to load resource … 400` for the deliberately rejected
replay — a completed expected response, not a JS error.
**Residue / follow-ups**: journey account deleted after the run
(`PasswordResetToken` cascade verified 1 → 0), `$TMPDIR` capture files
removed, dev servers stopped; Render/deployed-stack walkthrough still owed
with HP2's/HP3's (HP1 note). Tooling note for future journeys: `browser.fill`
appends instead of replacing when the target React-controlled input is
already non-empty — reload the page and fill each field once from empty.

### HP5 — Session hardening (refresh rotation, no storage token)
**Status**: pending
**Shipped**: —
**Deviations from plan**: —
**Gates**: —
**Live journey**: —
**Residue / follow-ups**: —

### HP6 — Security hygiene + admin runbook
**Status**: pending
**Shipped**: —
**Deviations from plan**: —
**Gates**: —
**Live journey**: —
**Residue / follow-ups**: —

### F1 — Quote → checkout (agreed price → payment screen)
**Status**: pending
**Shipped**: —
**Deviations from plan**: —
**Gates**: —
**Live journey**: —
**Residue / follow-ups**: —

### F2 — Order-scoped messaging (buyer/supplier/transporter)
**Status**: pending
**Shipped**: —
**Deviations from plan**: —
**Gates**: —
**Live journey**: —
**Residue / follow-ups**: —

### F3 — Payment-after-acceptance timing (optional)
**Status**: pending
**Shipped**: —
**Deviations from plan**: —
**Gates**: —
**Live journey**: —
**Residue / follow-ups**: —

---

## 4. Running notes

Cross-phase observations (baseline drift, decisions confirmed mid-flight,
environment issues). Newest first.

- 2026-11-15 — HP2 done (`518cf66`); test baselines drift api 453 → **473**
  (+20: totp vectors + two-factor suite), web 85 → **92** (+7 admin-2fa
  source assertions). Smoke grew to **21 flows** (new section T). Local dev
  stack used for the journey; Render re-check still owed.
- 2026-11-14 — Product review outcome: added **F1–F3** (quote→checkout,
  order-scoped messaging, payment-after-acceptance option) to plan §6 + this
  register after answering the payment-timing/chat questions from code (EFT is
  recordable only while PENDING today; quotes dead-end; no messaging tables
  exist). Decision: catalog checkout stays instant — chat is coordination, not
  a paywall. Execution order unchanged: **HP2 → … → HP6, then F1 → F2 → F3**.
- 2026-11-14 — HP1 done (`3ede15d`); web test baseline drifts 81 → **85** (+4
  checkout-payment). API untouched (453 unchanged). Dev servers used for the
  live journey, not the deployed stack — HP2+ journeys should re-check Render.
- 2026-11-14 — Plan written; both documents committed; HP1 not yet started.
