# BonAgri — Checkpoint Plan (Platform Expansion)

Companion document: `docs/IMPLEMENTATION_PLAN.md` (phases and design decisions).

Every phase of the platform expansion ends at a **checkpoint (CP)**: a commit that is
buildable, testable, deployable and demo-able. Nothing merges into `main` without its
checkpoint gates passing, and nothing carries over to the next phase broken.

## 1. Universal gates (every checkpoint, in order)

Run from the repo root unless noted. All must pass:

```bash
# 1. API
cd api && npm run build && npm test && npm run lint

# 2. Web
cd web && npm run build && npm run lint

# 3. Seed typecheck (any seed.ts change)
cd api && npx tsc --noEmit --ignoreConfig --target ES2023 --module nodenext \
  --moduleResolution nodenext --esModuleInterop --skipLibCheck --strict \
  --experimentalDecorators --emitDecoratorMetadata prisma/seed.ts

# 4. Schema changes only: regenerate + commit the client, then status-check Neon
cd api && npx prisma generate && npx prisma migrate dev --name <name>   # local
git add api/src/generated/prisma api/prisma/migrations                  # committed client
# Render build runs `prisma migrate deploy` against Neon automatically on push

# 5. Runtime acceptance (local dev DB)
bash scripts/runtime-smoke.sh

# 6. Commit + push (Render auto-redeploys both services)
# Conventional Commits, lowercase imperative

# 7. Live verification against the deployed stack
curl -s https://bonagri-api.onrender.com/api/health          # database: connected
# + the checkpoint's role-journey walkthrough (below) on https://bonagri-web.onrender.com
```

Pre-existing known failures that do **not** block a checkpoint (note them if hit):
`npm run test:e2e` in `api/` is broken (generated-client resolution, audit §10).

## 2. Checkpoint register

| CP | Phase | Date | Status |
|---|---|---|---|
| CP0 | Role & audit foundations | 2026-10-13 | done (b07b321) |
| CP1 | Supplier listing screens | 2026-10-13 | done (2d8c4bc) |
| CP2 | Consumer flow completion | 2026-10-13 | done (f4249e1) |
| CP3 | Admin management | 2026-10-13 | done (38fd535) |
| CP4 | Agro dealers | 2026-10-13 | done (426fa27) |
| CP5 | Disputes | 2026-10-13 | done (7545c5c) |
| CP6 | Glue & self-service | 2026-10-13 | done (02afeeb) |

Update the Status column (`pending` → `done (commit)`) as each CP lands.

## 3. Per-checkpoint specifics

### CP0 — Role & audit foundations
Extra gates:
- `npx prisma migrate status` → "Database schema is up to date" (local **and** Render DB).
- Smoke script still green (history writes must not break existing lifecycle steps).
- New unit tests: transition writer inserts `OrderStatusHistory` rows; admin sees
  platform-wide `GET /orders`; non-owner gets 404/403 on `GET /orders/:id`.
Role journey (deployed):
1. Admin env vars set → seed → admin logs in → lands on `/admin` placeholder.
2. Buyer and supplier logins still land on their existing screens (no regressions).
3. DB check: `SELECT COUNT(*) FROM "OrderStatusHistory"` grows after one lifecycle walk.

### CP1 — Supplier listing screens
Extra gates:
- New unit tests: `GET /supplier/products` ownership-scoped; `GET /products/:id` hides
  DRAFT/INACTIVE from anonymous/buyer but shows own DRAFT to owning supplier.
- Runtime smoke extended: supplier creates product via API → listed publicly →
  deactivated → hidden again.
Role journey (deployed): supplier → `/supplier/products` → create "Demo Produce"
(Active, initial stock) → buyer sees it on marketplace → supplier edits price →
buyer sees new price → supplier deactivates → listing disappears; supplier queue
shows **no** cancel button.

### CP2 — Consumer flow completion
Extra gates:
- Unit tests: address update/delete ownership + default reassignment; buyer cancel only
  own PENDING order; `GET /orders/:id` includes history for owner.
Role journey (deployed): buyer adds a second address, edits it, sets default; places
order → sees `/orders/:id` timeline advance as supplier fulfils; cancels a fresh
PENDING order (stock reservation released — verify `reservedQuantity` via API).

Status **done** (`f4249e1`, verified live 2026-10-13): 32 API unit tests; smoke
C1–C3 green; deployed journey confirmed — default moved then promoted back on delete,
order-used address → 400, reservation 0→1→0 around create+cancel, timeline
`PENDING → CANCELLED` by BUYER, buyer/supplier regressions 200.

### CP3 — Admin management
Extra gates:
- Unit tests: promote-to-supplier creates vendor profile exactly once; suspend blocks
  login (401/403) and existing token gets rejected at guard; verify-toggle readable
  publicly (`GET /products` supplier.verified).
Role journey (deployed): register a fresh buyer → admin promotes them to SUPPLIER →
that user re-logs-in and lands on `/supplier` hub → admin suspends them → login refused
→ admin reactivates; admin creates/renames a category visible on marketplace.

Status **done** (`38fd535`, verified live 2026-10-13): 49 API unit tests
(`admin.service.spec.ts` +17); new `AdminModule` — `GET /admin/stats`, `GET/PATCH
/admin/users` (search/role/status filters, suspend/reactivate — admins cannot be
suspended), `POST /admin/users/:id/promote-supplier` (profile exactly once, 409 on
repeat), `GET/PATCH /admin/suppliers` (verify toggle), `POST/PATCH /admin/categories`
(auto-slug, 409 on duplicate); full `/admin` console (layout + dashboard/users/
suppliers/categories/orders screens); `/orders/[id]` now buyer+admin; smoke A1–A3
green. Deployed journey: promote 201 → double-promote 409 → re-login SUPPLIER +
`/orders/supplier` 200 → suspend (token 401, login 401) → reactivate (login 201);
category created → public marketplace → renamed → public again, duplicate slug 409;
verify toggle read back via public `GET /products` then restored; all 5 admin web
screens 200; buyer/supplier regressions 200.

### CP4 — Agro dealers
Extra gates:
- Unit tests: AGRO_DEALER can create/list own products + see own orders; AGRO_DEALER
  **cannot** touch another vendor's products (ownership 404s); BUYER still blocked from
  vendor routes (403).
Role journey (deployed): dealer (seeded) logs in → hub shows dealer wording → lists
"Electric Fence Energizer 12J" under Tools → buyer filters marketplace Tools segment
→ orders it → dealer walks fulfilment → buyer sees DELIVERED.

Status **done** (`426fa27`, verified live 2026-10-13): 61 API unit tests (+12: dealer
advance/ownership/detail, dealer product create/scoping, 5× `RolesGuard`); `AGRO_DEALER`
added route-by-route to vendor `@Roles` sets (catalog listing/inventory/product-create
and `GET /orders/supplier`) + `updateOrderStatus` vendor branch; `Roles` decorator now
typed on `UserRole`; seed adds `dealer@bonagri.co.za` ("Limpopo Agro Equipment") with the
`Electric Fence Energizer 12J` listing under `agricultural-tools`; web: `/supplier/**`
guards widened (`allowedRoles`), hub renders "Agro Dealer Operations" for dealers,
marketplace gains the **All / Produce / Tools** segment control (explicit name→slug map
— slugifying "Agricultural Tools & Equipment" produces a wrong slug), new-listing form
gets **Produce/Tool unit presets**; smoke **D1–D3** green (incl. buyers 403 on vendor
routes, dealer cross-vendor edit 404). Deployed journey: dealer login → energizer listed
under the dealer profile publicly → buyer@ orders it → dealer walks
`PENDING→CONFIRMED→PROCESSING→READY_FOR_DELIVERY→OUT_FOR_DELIVERY→DELIVERED` → buyer
sees DELIVERED with full history; live guards 403/404; all supplier web screens 200;
buyer/supplier regressions 200. Smoke fixes along the way: buyer-order step pinned to
the seeded `fresh-tomatoes` listing (catalog now contains a second vendor), and the
admin category test made timestamp-unique (Category.name is `@unique`).

### CP5 — Disputes
Extra gates:
- Unit tests: dispute allowed only from eligible statuses and only by order buyer;
  vendor cannot open disputes; admin resolve/reject transitions; duplicate open dispute
  on same order rejected.
Role journey (deployed): buyer orders → supplier marks DELIVERED → buyer opens dispute
( DAMAGED ) → vendor sees it → admin resolves with note → buyer sees resolution →
resolution email actually arrives (SMTP already live); dispute appears in admin queue
with order history evidence.

Status **done** (`7545c5c`, verified live 2026-10-13): 74 API unit tests (+13:
eligibility statuses, owner-only, vendor blocked, duplicate 409 + P2002 race, vendor
scoping, admin resolve/reject transitions incl. note-required + terminal-state +
email-failure resilience); new **`Dispute`** model (`orderId` `@unique` → exactly one
dispute per order, `DisputeReason`/`DisputeStatus` enums, opener/resolver relations,
migration `20261013125752_add_disputes`, generated client committed); new
**`DisputesModule`** — `POST /orders/:id/dispute` (BUYER only, eligible only from
OUT_FOR_DELIVERY/DELIVERED), `GET /disputes/mine` (SUPPLIER+AGRO_DEALER, scoped via
order→items→product→supplier), `GET /disputes` + `PATCH /disputes/:id` (ADMIN;
OPEN→UNDER_REVIEW→RESOLVED/REJECTED, resolution note required to close, terminal states
immutable); **resolution email** via the existing SMTP service, best-effort so an SMTP
outage never blocks an admin decision (capture mode short-circuits → smoke never hits
real SMTP); `GET /orders/:id` now includes the dispute; web: buyer "Open dispute" form +
dispute/resolution panel on `/orders/[id]`, **Disputes** section on the vendor hub,
`/admin/disputes` queue (resolve/reject + note + order-history evidence panel, nav
entry); smoke **E1–E3** green (guards, eligibility, duplicate 409, vendor/dealer
scoping, admin queue evidence, resolve + captured resolution email, buyer sees outcome,
terminal + role guards). Deployed journey: buyer@ order `BON-20261013-703076` →
supplier delivers → `DAMAGED` dispute opened → duplicate 409 → vendor queue shows it
(dealer scoped empty; buyer 403 on the admin queue) → admin resolves with note (queue
carried 6 history entries as evidence; SendGrid resolution email dispatched,
`emailSent: true`) → buyer sees RESOLVED + note on the order → `/admin/disputes`,
`/orders/:id`, `/supplier` all 200. Smoke fix along the way: dispute email gets its own
capture file (`E2E_DISPUTE_CAPTURE_FILE`, default `.e2e/dispute-resolution.txt`) so the
verification capture is never overwritten.

### CP6 — Glue & self-service
Extra gates:
- Unit tests: notification rows written on configured transitions; apply→approve flow
  promotes role exactly once.
Role journey (deployed): buyer applies to sell → admin approves → user becomes dealer/
supplier on next login; notification emails observed for confirm/deliver/dispute.

Status **done** (`02afeeb`, verified live 2026-10-13): 100 API unit tests (+26:
transition map writes the right rows for the right people, email failure never breaks
the trigger, dispute-closed rows are row-only (CP5 already emailed), inbox scoping +
mark-read ownership; apply guards, reopen-after-reject, approve promotes exactly once
with profile+role+stamp in one transaction, 409s on every double-promotion path); new
**`SellerApplication`** model (`userId @unique` → one lifecycle per user, reopen on
re-apply after rejection, migration `20261013184325_add_seller_applications`,
generated client committed); new **`NotificationsModule`** (`GET /notifications`,
`PATCH /notifications/:id/read`) + **`SellerApplicationsModule`**
(`POST/GET /seller-applications`, `GET .../mine`, `PATCH /seller-applications/:id`).
Notification rows + best-effort emails on: order CONFIRMED/DELIVERED (→ buyer),
CANCELLED (→ vendor), dispute closed (→ buyer, row only), application decided and
supplier verified (row + email); single generic `sendNotificationEmail` with the same
capture-mode short-circuit as the dispute email (`E2E_NOTIFY_CAPTURE_FILE`, default
`.e2e/notifications.txt`). Web: buyer **`/apply`** page (apply as supplier/dealer,
status card, re-apply after rejection) + "Sell on BonAgri" header link,
**notifications panel** shared component on the buyer homepage + vendor hub,
`/admin/applications` console screen (+ nav entry). Smoke **F1–F3** (fresh
registered+verified applicant so the A2 promote journey stays untouched; apply →
duplicate 409 → vendor 403 → /mine + admin queue; confirm/deliver/dispute transitions
assert buyer notification rows + captured emails; approve → 201, re-approve → 409,
re-login as SUPPLIER, vendor hub 200, approval notification) — suite now 113 ✓ across
6 acceptance flows. Live journey: buyer@bonagri.co.za applied (PENDING, duplicate 409),
order `BON-20261013-774765` walked to DELIVERED (confirm+deliver emails via SendGrid),
dispute resolved (`emailSent: true` + dispute notification), admin approved
(approval email), re-approve 409, re-login → role SUPPLIER, `/orders/supplier` 200,
approval notification visible, `/mine` now 403; `/apply`, `/admin/applications`,
`/supplier` all 200. Known residue (accepted): buyer@bonagri.co.za is now a SUPPLIER
account.

## 4. Checkpoint hygiene rules

1. One phase = one PR-sized commit series ending in a green CP; no drive-by refactors.
2. Migrations are append-only; regenerate and **commit** `api/src/generated/prisma/`.
3. Extend `scripts/runtime-smoke.sh` in the phase that adds the endpoints it covers —
   the smoke script is the living acceptance suite.
4. If a checkpoint reveals a blocker, record it in `IMPLEMENTATION_PLAN.md` §5 Risks
   before continuing.
5. Production (Render/Neon) is only ever moved forward by push; verify the live
   journey at every CP — local green is not a checkpoint.
