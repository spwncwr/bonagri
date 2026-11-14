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
| HP2 | Admin 2FA (mandatory TOTP) + sign-in alerts | — | pending |
| HP3 | Step-up confirmation + admin audit trail | — | pending |
| HP4 | Password reset / account recovery | — | pending |
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
**Status**: pending
**Shipped**: —
**Deviations from plan**: —
**Gates**: —
**Live journey**: —
**Residue / follow-ups**: —

### HP3 — Step-up confirmation + admin audit trail
**Status**: pending
**Shipped**: —
**Deviations from plan**: —
**Gates**: —
**Live journey**: —
**Residue / follow-ups**: —

### HP4 — Password reset / account recovery
**Status**: pending
**Shipped**: —
**Deviations from plan**: —
**Gates**: —
**Live journey**: —
**Residue / follow-ups**: —

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
