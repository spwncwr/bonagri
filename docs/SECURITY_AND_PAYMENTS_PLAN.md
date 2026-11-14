# BonAgri — Security & Payments Implementation Plan

Status: **in progress — HP1 done (3ede15d, 2026-11-14); HP2 next** —
follow-on product phases **F1–F3** appended in §6 (2026-11-14 review: deal
agreement → payment, buyer/supplier/transporter messaging)
Companion document: `docs/SECURITY_AND_PAYMENTS_PROGRESS.md` (checkpoint register —
**update it after every phase**)
Gates reference: `docs/CHECKPOINT_PLAN.md` §1 (universal gates)

## 1. Goal

Close the security and payments gaps found in the 2026-11-14 review of the
running app, in six independently shippable phases:

1. **Buyer payment-method selection screen** (placeholder providers, no gateway).
2. **Admin sign-in hardening** — mandatory TOTP 2FA for ADMIN + sign-in alerts.
3. **Step-up confirmation + admin audit trail** for dangerous admin actions.
4. **Password reset (account recovery)** — does not exist at all today.
5. **Session/token hardening** — get the JWT out of `localStorage`.
6. **Security hygiene** — headers, CORS allowlist, admin onboarding runbook.

Each phase ends at a checkpoint (**HP1–HP6**): buildable, testable, demo-able,
committed, and recorded in the progress document before the next phase starts.

§6 appends three **product** phases (**F1–F3**, added 2026-11-14) that came out
of the same review: wiring accepted quotes into checkout ("agree the deal, then
pay"), order-scoped buyer/supplier/transporter messaging, and the optional
payment-timing change. They are tracked in the same progress register.

## 2. Investigation findings (ground truth, verified 2026-11-14)

### 2.1 What is already solid (do not re-build)

| Area | Evidence |
|---|---|
| Password hashing | bcrypt, 12 rounds (`auth.service.ts:41,266`) |
| Email verification before login | required; tokens hashed at rest (`hashToken`) |
| Rate limiting | throttler: register 10/min, login 15/min, verify-email 15/min, resend 5/min (`auth.controller.ts:38-57`); `trust proxy: 3` tuned for Render (CP13) |
| AuthZ | `JwtAuthGuard + RolesGuard + @Roles(...)` on every mutating controller; ownership re-checked in services |
| Admin onboarding | seed-only, env-gated (`seed.ts:179-208`); **no** endpoint can create/promote an admin |
| Verification (anti-scam) | CP17: role-enforced document requirements (CIPC etc.), single privileged `admin/verification` path, `VerificationAuditLog` on every decision, private signed document URLs, checkout 403 gates (`PHONE_VERIFICATION_REQUIRED` …) |
| Review fraud | reviews only from buyers with a **DELIVERED** order (`reviews.service.ts:145-150`) |
| Payment evidence flow | CP11 manual EFT: record → supplier verify/reject → PAID; invoices idempotent |

### 2.2 Gaps this plan closes

| # | Gap | Evidence |
|---|---|---|
| G1 | **No payment-method selection screen** — checkout goes cart → address → "Place order" with no payment step | `web/app/checkout/page.tsx:188-197` (body = address + notes only) |
| G2 | **No admin 2FA / MFA anywhere** — grep for totp/mfa/2fa across `api/src` returns nothing; admin = one password | `auth.controller.ts` has only register/login/verify/resend/me |
| G3 | **Admin actions confirmed only by `window.confirm`** — a mis-click guard, not a security control; only verification decisions have a real audit trail | `admin/users/page.tsx:141,265`, `admin/banners/page.tsx:217`, `admin/promotions/page.tsx:376`, `admin/transporters/page.tsx:85` |
| G4 | **No password reset** — `auth.controller.ts` exposes no forgot/reset route; a forgotten password = dead account | route list: register, login, verify-email, resend-verification, me |
| G5 | **JWT lives in `localStorage`/`sessionStorage`** — any XSS persists a stolen session for 24h | `web/lib/auth.ts:74-89`, expiry 86400s (`auth.module.ts:19`) |
| G6 | **No security headers / CORS allowlist documented**; admin onboarding exists only as tribal knowledge | to be pinned down at phase start (investigation task) |

### 2.3 Assets to leverage (avoid schema earthquakes)

- `PaymentProvider` enum already exists: `OZOW | PAYFAST | MANUAL` (`schema.prisma:51-55`)
  — placeholder providers need **no enum change**.
- `hashToken()` pattern (hashed, expiring, single-use tokens) already powers
  email verification — password reset reuses it.
- Mail service already has capture-mode for smoke (`E2E_CAPTURE_MAIL`) — 2FA
  enrolment and password-reset emails ride it for free.
- `VerificationAuditLog` is the template for the new `AdminAuditLog`.
- `ThrottlerGuard` + per-route `@Throttle` is in place — new auth routes get budgets.

## 3. Design decisions

| ID | Decision | Chosen approach | Alternatives rejected |
|---|---|---|---|
| D1 | Payment-method screen scope | UI step in `/checkout`: **Manual EFT** selectable (today's flow), **Card (PayFast)** and **Instant EFT (Ozow)** shown as disabled "Coming soon" tiles; choice echoed on order confirmation + order detail. **No migration** — a `Payment` row is still only created when real evidence exists (CP11), always `MANUAL` while the others are placeholders | Creating `Payment` rows at checkout for disabled providers (fake data, breaks CP11 invariants); picking a provider per-order column (schema churn for a placeholder) |
| D2 | Admin 2FA | **TOTP (RFC 6238)**, **mandatory for ADMIN**: first admin login without 2FA redirects to enrolment (QR + secret + one-time recovery codes); login becomes two-step (password → short-lived pre-auth token → code). Other roles unchanged | WebAuthn/passkeys (no usable second device in this user base); SMS OTP (needs a paid provider); optional 2FA (the whole point is closing G2) |
| D3 | Step-up confirmation | `POST /auth/step-up` re-checks the password → **5-minute step-up token** sent as `X-Step-Up` on dangerous admin mutations; frontend shows a password re-entry modal first. Every admin mutation writes an `AdminAuditLog` row; verification decisions keep their own `VerificationAuditLog` (no double-write) | Re-prompting 2FA per action (fatigue → people disable it); `window.confirm` alone (status quo, G3) |
| D4 | Password reset | Mirrors email verification: always-`202` response (no account enumeration), token hashed at rest, single-use, expiring, emailed link → `/reset-password` | Security questions (phishable); SMS reset (paid provider) |
| D5 | Session hardening | **Refresh-token rotation**: access token 15 min kept in **memory only** (not storage), refresh token in an **httpOnly SameSite=Lax cookie**, server-side `RefreshToken` rows with rotation + revocation; `lib/auth.ts` gains a silent refresh on 401 | Full cookie session for everything (forces `credentials:'include'` + CSRF rework on every fetch — bigger blast radius); status quo localStorage (G5 stays open) |
| D6 | Hygiene scope | Next.js security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy), explicit CORS allowlist for the web origin, and a committed admin-onboarding runbook | helmet in front of Next (double-handling; Next headers suffice) |

## 4. Phases

Universal gates for every phase: `docs/CHECKPOINT_PLAN.md` §1 —
api build/test/lint, web build/lint/test, `bash scripts/runtime-smoke.sh`
(extended per phase), Conventional Commit + push, progress doc updated.
Baseline at plan time: **api 453 tests, web 81 tests** (re-verify at each phase
start — drift is a signal, not a failure).

### HP1 — Buyer payment-method selection screen (G1)

- **Web** (`web/app/checkout/page.tsx`):
  - New **Payment method** card between address picker and summary:
    - *Manual EFT* — radio, selected by default, copy: "Pay from your bank app
      and record the EFT reference after ordering (verified by the supplier)".
    - *Card — PayFast* and *Instant EFT — Ozow* — visibly **disabled** tiles
      with a "Coming soon" badge (not selectable, honest about state).
  - Selection stored in `sessionStorage` (`bonagri_checkout_payment_method`)
      like the existing notes hand-off; shown on the checkout success screen and
      on `/orders/[id]` ("Payment method: Manual EFT").
  - No API change: `POST /api/cart/checkout` body stays `{deliveryAddressId, notes}`.
- **Gates**: web build/lint/test; manual journey (below); smoke untouched
  (backend unchanged — note this explicitly in the progress doc).
- **Exit criteria**: buyer at `/checkout` sees the method screen, EFT selects,
  placeholders are obviously disabled, chosen method visible on the order page
  after placing; guest/verification gates (`PHONE_VERIFICATION_REQUIRED`)
  still route correctly.

### HP2 — Admin 2FA (mandatory TOTP) + sign-in alerts (G2)

- **Schema** (one migration + committed generated client):
  - `User` += `twoFactorEnabled Boolean @default(false)`,
    `twoFactorSecret String?` (base32, DB-access-is-game-over threat model —
    documented in code), `twoFactorRecoveryCodes String?` (JSON array of
    SHA-256 hashes), `twoFactorEnabledAt DateTime?`.
- **API** (extend `auth/` + small `admin/` additions):
  - `POST /auth/2fa/setup` (authenticated) → secret + `otpauth://` URI
    (secret shown exactly once).
  - `POST /auth/2fa/enable` (authenticated) → verifies one TOTP code, stores,
    returns **10 single-use recovery codes** (shown once).
  - `POST /auth/2fa/disable` → requires password **and** current code.
  - **Login flow**: `POST /auth/login` for an ADMIN with 2FA enabled returns
    `{twoFactorRequired: true, preAuthToken}` (pre-auth TTL 5 min, **no JWT**);
    `POST /auth/2fa/verify` (throttled, e.g. 10/min) exchanges code or recovery
    code for the real JWT. Recovery codes are single-use (hash rotated on use).
  - **Enforcement**: ADMIN login with `twoFactorEnabled = false` →
    `twoFactorSetupRequired: true` (no JWT until setup completes) — this is what
    makes it *mandatory*.
  - **Sign-in alert**: best-effort email on every successful admin login
    (IP + time) via the existing mail service (capture-mode safe).
- **Web**:
  - Login page: 6-digit code step (and "use a recovery code" fallback).
  - `/admin/security` (AuthGuard ADMIN): enrolment wizard (QR via a small
    TOTP-URI QR — render `otpauth://` as QR using an existing tiny helper or a
    dependency-free QR component; investigate at phase start), recovery-codes
    reveal-once panel, disable flow.
  - Login redirects `twoFactorSetupRequired` → `/admin/security`.
- **Gates**: unit tests (wrong code 401, pre-auth expiry, pre-auth cannot be
  replayed for a second JWT, recovery code single-use, setup-required blocks
  JWT issuance, throttling on `/2fa/verify`); smoke section **N** (admin enrol →
  login 2-step → wrong code → recovery code → alert email captured); web
  build/lint; deployed browser journey.
- **Exit criteria**: admin cannot reach `/admin` without a TOTP code (or
  recovery code); recovery path proven; alert email observed in capture file.

### HP3 — Step-up confirmation + admin audit trail (G3)

- **Schema**: new `AdminAuditLog` — `actorUserId`, `action`, `targetType`,
  `targetId`, `metadata Json?`, `ip?`, `userAgent?`, `createdAt` (indexed on
  `actorUserId + createdAt`). Template: `VerificationAuditLog`.
- **API**:
  - `POST /auth/step-up` (any authenticated user) → re-checks password →
    short-lived (5 min) step-up token.
  - Guard `StepUpGuard`: dangerous admin routes require `X-Step-Up` header
    valid within TTL → else **428/403** with a machine-readable code.
    Route list: `PATCH admin/users/:id/status`, both promote endpoints,
    `PATCH admin/transporters/:id`, `PATCH admin/suppliers/:id`,
    `POST/PATCH admin/categories`, `POST admin/notifications/broadcast`,
    `POST/PATCH admin/banners*`, promotions mutations, transporter verify.
    (`admin/verification` decisions excluded — they keep their own trail per D3.)
  - Every guarded mutation writes an `AdminAuditLog` row in the same
    transaction as the mutation.
- **Web**:
  - Shared **re-auth modal** (password field → `POST /auth/step-up` → retry
    original request with the header) used by all admin screens; replaces the
    bare `window.confirm` on destructive actions (confirm step stays for
    mis-clicks, re-auth for security).
  - New `/admin/audit` page: recent-activity table (time, actor, action,
    target) with filters; nav entry.
- **Gates**: unit tests (missing/expired step-up → 403, correct → 200, non-admin
  never passes, audit row written atomically — mutation rolls back with it);
  smoke section **O**; web build/lint.
- **Exit criteria**: promoting a user from the UI prompts password re-entry;
  a forged/expired header is rejected server-side; the action appears in
  `/admin/audit`.

### HP4 — Password reset / account recovery (G4)

- **API** (extend `auth/`):
  - `POST /auth/forgot-password` → always `202` (no enumeration), rate-limited
    (5/min), emails a link when the account exists; token hashed at rest,
    TTL ~30 min, single-use (reuse `hashToken` pattern).
  - `POST /auth/reset-password` → `{token, password}` → updates `passwordHash`
    (bcrypt 12), invalidates the token, **revokes all refresh tokens** for that
    user (prepares HP5 — if HP5 lands later, skip the revoke with a comment).
  - Login rejects `SUSPENDED` as today; reset does not bypass it.
- **Web**: `/forgot-password` (email → always-success message), `/reset-password`
  (new password + confirm, strength/length rules matching register), links from
  the login page ("Forgot password?").
- **Gates**: unit tests (unknown email → 202 no-leak, expired/used token → 400,
  success changes the hash and kills the token, throttling); smoke section **P**
  (full reset journey through the captured email); web build/lint.
- **Exit criteria**: a buyer who forgot their password recovers access end to
  end without DB surgery.

### HP5 — Session hardening: refresh rotation + no token in web storage (G5)

- **Schema**: new `RefreshToken` — `tokenHash @unique`, `userId`, `expiresAt`,
  `revokedAt DateTime?`, `replacedByHash String?`, `createdAt` (+ index on
  `userId`); access-token TTL drops 24h → **15 min** (constant, env-overridable
  for the transition).
- **API**:
  - `POST /auth/login` / `/auth/2fa/verify` additionally set
    `Set-Cookie: refresh_token=…; HttpOnly; SameSite=Lax; Secure; Path=/api/auth`
    and return the short-lived access token in the body (current shape).
  - `POST /auth/refresh` (cookie only) → rotates: old row revoked +
    `replacedByHash` chained; reuse of a rotated token → revoke the whole
    family (theft detection) + 401.
  - `POST /auth/logout` → revokes the presented refresh row + clears cookie.
  - CORS: explicit origin allowlist (`WEB_BASE_URL`), `credentials: true`.
- **Web** (`lib/auth.ts` rework — the risky part, budget it):
  - Access token lives in a module-level variable (memory), not
    `localStorage`/`sessionStorage`; `authHeaders()` unchanged for callers.
  - Silent refresh on 401 (single in-flight refresh, queue concurrent callers);
    `saveAuth`/`clearAuth` keep their signatures so pages don't change.
  - `rememberMe` now only controls cookie Max-Age, not storage choice.
  - Migration: on load, a legacy stored token is used **once**, then the
    refresh flow takes over and storage is purged (graceful cutover).
- **Gates**: unit tests (rotation chain, reuse-detection revokes family, expiry
  → 401, cookie attributes); smoke section **Q** (login → refresh → logout →
  old cookie dead); web build/lint; **browser journey**: login, hard reload
  keeps session, logout everywhere, access-token expiry silent续 (15 min —
  simulate by setting TTL to 5s in a local run).
- **Exit criteria**: no `localStorage`/`sessionStorage` token on a fresh login;
  logout kills the session server-side; stolen access token dies in ≤15 min and
  cannot be refreshed from JS.

### HP6 — Security hygiene + admin runbook (G6)

- **Web**: `next.config` headers — CSP (start `report-only`, tighten after a
  browser pass; Cloudinary/img allowances pinned), HSTS, X-Frame-Options,
  Referrer-Policy, Permissions-Policy.
- **API**: verify CORS allowlist + helmet-equivalent headers (Nest `helmet` if
  not double-handled by the proxy — investigate first); confirm health stays
  unthrottled.
- **Docs**: `docs/ADMIN_ONBOARDING.md` runbook — create admin via env-gated
  seed, mandatory 2FA enrolment, recovery-code custody, password rotation,
  what to do if both TOTP device and recovery codes are lost (documented
  env-gated reset path), audit-log review cadence.
- **Gates**: web build/lint; browser pass proving no CSP breakage (marketplace,
  Cloudinary images, checkout, invoice print); smoke still green; docs committed.
- **Exit criteria**: headers visible in response/`_next` config, CORS rejects a
  foreign origin, runbook merged.

### Ordering & rationale

**HP1 → HP2 → HP3 → HP4 → HP5 → HP6.**
HP1 first: pure frontend, immediate user value, zero risk to auth. HP2/HP3
harden the highest-value account before HP5 touches the token flow everything
depends on (2FA login lands on today's JWT so HP5 later extends it without
rework). HP4 is independent but sits before HP5 so reset can revoke refresh
tokens. HP6 is the wrap-up that also updates the runbook to describe the
finished state.

## 5. Risks

1. **HP2 lockout** — mandatory 2FA with a lost device = admin lockout. Mitigation:
   recovery codes shown once at enrolment + documented DB-reset path in the
   HP6 runbook; never ship HP2 without the recovery-code tests green.
2. **HP5 is the highest-blast-radius phase** — `lib/auth.ts` feeds every page.
   Mitigation: legacy-token cutover, silent-refresh tests, full smoke, and the
   browser journey before declaring done; keep it as its own checkpoint so a
   regression is one revert away.
3. **QR generation without a heavy dependency** — investigate a dependency-free
   otpauth QR renderer at HP2 start; if none is acceptable, a tiny audited
   package is allowed (decision recorded in the progress doc).
4. **CSP breaking Cloudinary/invoice print** — report-only first (HP6).
5. **Neon free-tier migrations** — same as CP risks: `migrate deploy` on Render,
   cold-start P1002 → redeploy warm.
6. **Baseline drift** — api/web test counts move between phases; record the
   actual numbers in the progress doc each time rather than assuming.
7. **F2 messaging scope creep** — chat can balloon (real-time infra, media,
   moderation, read receipts). Mitigation: MVP is polling-only, text-only,
   order-scoped threads reusing existing notifications as pings; WebSocket and
   media are explicitly out of scope for F2.

## 6. Follow-on product phases (F1–F3) — added 2026-11-14

Raised in the 2026-11-14 review ("payment after the deal is agreed?", a chat
screen for buyer↔supplier, mid-journey buyer↔transporter conversation).
Nothing here was in the original HP scope — recorded so it is tracked.
**Default order: F1 → F2 → F3, running after HP6** (user may reorder).

Ground truth verified 2026-11-14:

- The "agree the deal" primitive already exists — CP7 product requests with
  vendor **quotes** (`quotedPrice`, buyer ACCEPT/DECLINE) — but **accepting a
  quote dead-ends**: it never reaches checkout, and checkout prices from
  product rows server-side, so the agreed price is lost.
- **No messaging exists anywhere** (no message/thread tables in the schema);
  comms primitives are in-app notifications + email only. `IMPLEMENTATION_PLAN`
  D6 explicitly deferred threaded dispute messages as v1-overscope.
- Transport structure is ready for comms (CP12/CP14/CP15: jobs board, claim,
  driver name/phone, checkpoints, step notifications) — but no conversation.
- Payment timing today: EFT can be recorded **only while PENDING** (before
  supplier acceptance), and no transition is ever gated on payment —
  "payment is evidence, not authority" (CP11).
- How this compares to the market (decision context): buy-now catalogs
  (Takealot/Jumia/Amazon) charge at checkout with no chat; negotiated/P2P
  marketplaces (FB Marketplace, OLX) chat first then pay; B2B RFQ platforms
  mirror the existing requests flow. Recommendation recorded in F1/F3 below:
  **do not gate the catalog checkout behind chat** — chat is coordination, not
  a paywall.

### F1 — Quote → checkout (agreed price → payment screen)

- Wire the accepted-quote flow into checkout so the buyer proceeds to HP1's
  payment screen at the **quoted price**. Server-side pricing means the quote
  must be trusted by the API — investigate the cheapest mechanism at phase
  start (accepted-quote checkout token vs. creating the order directly from
  the accepted quote); today's `POST /api/cart/checkout` prices from product
  rows and cannot honour a quote.
- Catalog (fixed-price) checkout stays exactly as it is — chat/quotes are an
  additional path, never a paywall (see §6 rationale).
- **Exit criteria**: buyer accepts a vendor quote → checkout shows the agreed
  price → order placed → existing CP11 EFT flow unchanged; smoke extended.

### F2 — Order-scoped messaging (buyer ↔ supplier ↔ transporter)

- One thread per order; participants = buyer, owning supplier(s), assigned
  transporter (once claimed), admin read-only. Optional pre-order product
  inquiry room if it falls out cheaply — decide at phase start.
- MVP scope: **polling only** (no WebSocket), text-only, unread badge,
  notifications reused as pings, per-route rate limits, 404-no-leak on foreign
  orders. Media, read receipts, WebSocket push: explicitly out.
- **Exit criteria**: buyer ↔ supplier exchange messages on a live order in the
  browser; buyer ↔ assigned transporter during OUT_FOR_DELIVERY; foreign order
  → 404; unit tests cover participant matrix + leak guards.

### F3 — Payment-after-acceptance timing (optional — decide at start)

- The user's mental model: agree → **then** pay. Catalog orders today ask for
  the EFT while PENDING (before acceptance). F3 decides between:
  - **UX-only**: the prominent "record EFT" step moves to after `CONFIRMED`
    (early recording stays allowed, no API change), sequence reads accept →
    pay; or
  - **Hard gate**: `recordPayment` rejects until `CONFIRMED` (API change +
    smoke + copy updates across buyer/supplier screens).
- May fold into F1 (both touch the payment sequence) — decide when it starts.
