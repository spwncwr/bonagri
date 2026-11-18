# BonAgri — Admin onboarding & security runbook

**Scope**: every account with role `ADMIN`, in any environment.
**Status**: current as of HP6 (Security & Payments plan, 2026-11-17) —
mandatory 2FA (HP2), step-up + audit trail (HP3), password reset (HP4),
rotating HttpOnly sessions (HP5), headers + this runbook (HP6).

**Non-negotiables**

- No HTTP endpoint can create or promote an admin. The privileged admin
  routes only promote suppliers/transporters — admins come from the
  env-gated seed below or a deliberate direct DB write (§6).
- Never commit, print or paste `SEED_ADMIN_PASSWORD`, `JWT_SECRET`,
  `DATABASE_URL` or any recovery code. Values live in the environment and
  your password manager only.
- Credentials seeded for local development (including the ones in
  `api/prisma/seed.ts` and smoke scripts) are for local use only — never
  reuse them anywhere real.

## 1. Create (or rotate) the admin account — env-gated seed

The only supported creation path is `api/prisma/seed.ts`, invoked as
`npx prisma db seed` from `api/` (wired to `tsx prisma/seed.ts` via
`prisma7.config.ts`). The seed upserts the admin and refuses to run unless
**all** of these hold:

1. `DATABASE_URL` is set;
2. `SEED_DEVELOPMENT_DATA=true` (explicit opt-in — the seed mutates data);
3. `NODE_ENV` is **not** `production` (production runtimes are never seeded);
4. the target is a local database, **or** `SEED_ALLOW_REMOTE=true` names a
   throwaway remote environment you own;
5. `SEED_ADMIN_EMAIL` **and** `SEED_ADMIN_PASSWORD` are both set — otherwise
   the seed skips the admin account entirely.

```bash
cd api
# Generate a strong password and store it in the password manager first.
export SEED_ADMIN_PASSWORD="$(openssl rand -base64 24)"
export SEED_ADMIN_EMAIL="ops-admin@yourdomain.example"
export SEED_DEVELOPMENT_DATA=true
npx prisma db seed
# → "Admin account ready: <email>" is the only success line; the password
#   is never printed.
```

**Re-running the seed rotates the admin password** (the upsert rewrites
`passwordHash`, bcrypt cost 12, and re-asserts `role`/`status`/
`emailVerifiedAt`). It does **not** touch 2FA fields — an existing
enrolment survives a seed re-run (see §6 for the 2FA reset).

## 2. First sign-in — mandatory 2FA enrolment

Admin sign-in is two-step **at the API level**: the password step answers
`{ twoFactorRequired: true, preAuthToken }` and no session token exists
until TOTP succeeds. There is no skip path, in any environment.

1. Sign in at `/login` with the account from §1.
2. Scan the QR (or enter the secret) in your authenticator app —
   TOTP, RFC 6238, 30-second window.
3. Confirm with a 6-digit code. The API answers with **10 recovery codes**,
   shown exactly once, with a copy button (`/admin/security` → "Save your
   recovery codes").
4. Store the recovery codes **before** closing the tab (§3).
5. A sign-in alert email is sent on every admin sign-in (HP2). Confirm the
   first one arrives — it is your intrusion alarm from now on.

Completing enrolment completes the sign-in (enrolment-as-login), so you
land in the admin area with a normal session.

## 3. Recovery-code custody

- **10 codes** (`RECOVERY_CODE_COUNT`), 12 hex characters each, uppercase,
  shown **once** at enrolment. The database stores only their SHA-256
  hashes — losing the displayed codes means they are gone.
- Codes are **single-use**: a consumed code is rotated out of the stored
  set. Never reuse one.
- A recovery code works in two places:
  - the second sign-in step (`POST /api/auth/2fa/verify`) in place of TOTP;
  - `POST /api/auth/2fa/disable` together with your password — the designed
    lost-device path (also reachable from `/admin/security`).
- **Where to keep them**: a password-manager entry separate from the
  password, or printed and sealed — anywhere you can reach them *without*
  the phone holding the authenticator. Never in the repo, a ticket, chat,
  or on the machine you sign in from.
- **Rotating the set**: disable 2FA with password + one current code, then
  re-enrol (§2) — you get 10 fresh codes and a fresh secret.

## 4. Password rotation

- **Standard path**: `/forgot-password` → single-use link valid **30
  minutes** → set a new password. The reset also **revokes every active
  refresh session** (HP5), so all devices must sign in again (with 2FA).
- **Local dev shortcut**: re-run the env-gated seed (§1) — rotates the
  password only; 2FA enrolment is untouched.
- Rotate immediately if: a sign-in alert email you did not trigger
  arrives, a recovery code is missing, or the password may have been
  observed. After rotating, review the audit log (§7).

## 5. Lost TOTP device **and** all recovery codes

Work the ladder top-down; stop at the first rung that applies.

1. **Any recovery code still works?** → sign in with it (the second step
   accepts it), or disable 2FA from `/admin/security` with password + code,
   then re-enrol (§2). Done — no DB access needed.
2. **Nothing left** → the env-gated DB reset below, then the mandatory
   follow-ups. This is the *only* remaining 2FA reset path: no endpoint and
   not even the seed can clear an enrolment (production refuses the seed
   outright, so this manual path is also the production procedure). It is
   deliberately manual — per the schema's threat model, DB access is
   already game over; this procedure just keeps the blast radius auditable.

```bash
cd api
DB_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d "\"'")"
# Never echo or commit $DB_URL.

# Gate: refuse to proceed without an explicit, typed confirmation.
test "${ADMIN_2FA_RESET_APPROVED:-}" = "yes" || {
  echo "Refusing. Re-run with ADMIN_2FA_RESET_APPROVED=yes only after" >&2
  echo "verifying the target row below and noting the incident." >&2
  exit 1
}

# Step 1 — verify the target FIRST: exactly one row, correct account.
psql "$DB_URL" -c \
  "SELECT email, role, \"twoFactorEnabled\" FROM \"User\"
   WHERE email = '<admin-email>' AND role = 'ADMIN';"

# Step 2 — only then clear the enrolment.
psql "$DB_URL" -c \
  "UPDATE \"User\"
   SET \"twoFactorEnabled\" = false,
       \"twoFactorSecret\" = NULL,
       \"twoFactorRecoveryCodes\" = NULL,
       \"twoFactorEnabledAt\" = NULL,
       \"twoFactorPreAuthHash\" = NULL,
       \"twoFactorPreAuthExp\" = NULL
   WHERE email = '<admin-email>' AND role = 'ADMIN';"
```

**Mandatory follow-ups** (same session, in order):

1. Re-run the SELECT and confirm `twoFactorEnabled = f`;
2. run `/forgot-password` for the account — rotating the password revokes
   every outstanding refresh session (HP5), so a hijacked device is cut
   off too;
3. sign in — the API will force fresh 2FA enrolment on the spot (§2);
   store the new recovery codes;
4. record the incident (who approved, when, why) in the ops log;
5. review the audit log (§7) around the incident window for anything you
   cannot attribute.

## 6. Day-to-day admin security

- **Step-up confirmation**: guarded admin mutations (user status/promote,
  supplier/transporter verify, categories, banners, broadcasts,
  promotions) ask for a step-up code from your authenticator (HP3). Treat
  a step-up prompt you did not initiate as an incident.
- **Sessions** (HP5): access tokens live ≤15 minutes; sessions rotate
  through an HttpOnly refresh cookie (30 days with "remember me", 12 hours
  otherwise). Sign out kills the session server-side — use it on shared
  machines.
- **Sign-in alerts**: one email per admin sign-in (HP2). No alert
  suppression exists — if mail stops arriving, investigate the mail path
  first, then the account.

## 7. Audit-log review cadence

- **Where**: web `/admin/audit`, or `GET /api/admin/audit` (ADMIN JWT;
  filters `action`, `actor`, `limit`).
- **What is recorded**: every guarded admin mutation — the machine names in
  `api/src/audit/actions.ts` (17 today): `USER_STATUS_UPDATE`,
  `USER_PROMOTE_SUPPLIER`, `USER_PROMOTE_TRANSPORTER`, `SUPPLIER_VERIFY`,
  `TRANSPORTER_VERIFY`, `CATEGORY_CREATE`, `CATEGORY_UPDATE`,
  `BROADCAST_SEND`, `BANNER_CREATE`, `BANNER_UPDATE`, `BANNER_DELETE`,
  `PROMOTION_CREATE`, `PROMOTION_UPDATE`, `PROMOTION_PUBLISH`,
  `PROMOTION_PAUSE`, `PROMOTION_RESUME`, `PROMOTION_DELETE`.
  (Verification decisions live in the separate `VerificationAuditLog` —
  review those under `/admin/verification`.)
- **Cadence**:
  - **weekly** — full pass over the newest entries;
  - **immediately** — after any sign-in alert, lost-device event (§5),
    credential rotation (§4), or admin joining/leaving;
  - **spot-check** — after anything unusual: entries you cannot attribute
    to a ticket, `USER_STATUS_UPDATE`/`PROMOTION_*` bursts, activity outside
    business hours, or an actor email you do not recognise.
- **Red flags**: an actor you do not know, actions with no ticket, a
  sequence that ends in `BROADCAST_SEND` or `BANNER_*` you did not order.

## 8. Onboarding checklist

- [ ] Admin created via the env-gated seed (§1); password in password
      manager, not the environment of anyone else's machine
- [ ] First sign-in completed; 2FA enrolled; **10 recovery codes stored**
      somewhere reachable without the authenticator device (§3)
- [ ] Sign-in alert email received and mail path confirmed working (§2)
- [ ] `/admin/audit` reachable as this account (§7)
- [ ] Recovery ladder understood — especially §5, before you need it
- [ ] Password rotated away from any value that ever touched a repo,
      ticket or chat (§4)
