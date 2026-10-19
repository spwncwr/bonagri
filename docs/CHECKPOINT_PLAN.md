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
~~`npm run test:e2e` in `api/` is broken~~ — **fixed in CP13** (Jest
`moduleNameMapper` + rewritten spec; now 2 passed).

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
| CP7 | Product requests (buyer demand) | 2026-10-13 | done (23417b1) |
| CP8 | Landing-page wiring (dead CTAs) | 2026-10-14 | done (372a595) |
| CP9 | Request responses (demand loop) | 2026-10-14 | done (ca46630) |
| CP10 | Cart & multi-item checkout | 2026-10-14 | done (0475e89) |
| CP11 | Payments (manual EFT + invoices) | 2026-10-14 | done (4a6067b) |
| CP12 | Delivery tracking | 2026-10-18 | done (d8e180c) |
| CP13 | Trust & ops hygiene (CI, e2e fix, rate limiting) | 2026-10-19 | done (385034a–a0c19be) |
| CP14 | Transporter role (delivery jobs) | — | pending |

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

### CP7 — Product requests (buyer demand)
Extra gates:
- Unit tests: create guards (unknown category, past requiredBy), owner-only
  withdraw (foreign/unknown → 404), OPEN→FULFILLED/WITHDRAWN transitions with
  terminal states → 409, public list scoping (OPEN only, no buyer identity).
Role journey (deployed): buyer posts a request → it appears on the **public**
demand board (no auth, no buyer identity) → buyer withdraws it → it leaves the
board and /mine shows WITHDRAWN; anon create 401, vendor create 403.

Status **done** (`23417b1`, verified live 2026-10-14): 110 API unit tests (+10);
new **`ProductRequest`** model (`OPEN` → `FULFILLED`/`WITHDRAWN`, optional
`Category` relation, migration `20261013210321_add_product_requests`, generated
client committed); new **`RequestsModule`** — public `GET /product-requests`
(explicit `select`: the smoke caught Prisma's default `buyerId` scalar leaking,
now excluded and asserted in both spec and smoke), buyer `POST` / `GET .../mine`
/ `PATCH :id` (owner-only, 404 for foreign ids, 409 out of terminal states,
`requiredBy` must not be in the past); web: `/requests` page (post form +
my-requests with status chips + withdraw/fulfil), landing `#requests` shows
real OPEN requests (example card became the empty-state), vendor hub gained a
read-only **Buyer requests** section; smoke **G1–G3** (+ web route checks
`/requests`, `/apply`) — suite now 121 ✓ across 7 acceptance flows. Live
journey 2026-10-14 (approved temporary-demote of buyer@ on Neon, restored to
SUPPLIER and re-verified): create OPEN → public board (no identity) → guards
→ withdraw → board clean → 409 on re-transition.

### CP8 — Landing-page wiring (dead CTAs)
Extra gates:
- web build + lint; smoke web-route checks (`/requests`, `/apply` → 200).
Role journey (deployed): category card click filters the marketplace (segment +
category chip light up, smooth scroll); "Become a supplier" lands buyers on
`/apply` and vendors on a "you already sell" card linking to their hub;
"Learn more" scrolls to `#how-it-works`; footer carries quick links.

Status **done** (verified live 2026-10-14): the four dead landing controls are
wired — **Explore-categories cards** now derive from the same
`SEGMENT_CATEGORIES`/`CATEGORY_SLUGS` universe as the marketplace chips (kills
the drift: 9 cards incl. Agricultural Tools, Seeds & Chemicals, Poultry &
Livestock) and clicking sets segment + category + scrolls; **"Become a
supplier"** → `/apply` (page widened to accept vendor roles — vendors get a
"you already sell on BonAgri" card with a hub link instead of a guard bounce);
**"Learn more"** → `#how-it-works` anchor; **footer** quick links
(Marketplace, Product Requests, How it works, Sell on BonAgri, Sign in). One
build hiccup on the way: the smoke's killed dev server left a corrupt
`.next/dev/types/validator.ts` that broke `next build`'s typecheck — stale
artifact, cleared, gitignored, never committed.

### CP9 — Request responses (demand-board loop)
Extra gates:
- Unit tests: respond guards (no supplier profile → 403, duplicate → 409,
  non-OPEN request → 409), buyer-owner-only reads (foreign/unknown → 404),
  accept transaction (auto-declines competing OPEN responses + notifies the
  winning vendor), vendor-only withdraw / buyer-only accept-decline (wrong
  actor → 404), acting on non-OPEN response → 409.
Role journey (deployed): two vendors respond to one buyer request → buyer sees
both with business names (no ids) → accepts one → the other is auto-DECLINED
in the same transaction → the accepted vendor gets a notification → the public
board shows a live-only interested count → vendor withdraws their own OPEN
response; late respond on a withdrawn request → 409.

Status **done** (`ca46630`, verified live 2026-10-14): 119 API unit tests (+9); new
**`RequestResponse`** model (unique `[requestId, supplierId]` — one response
per vendor per request; `quotedPrice?` + `quotedUnit?`; migration
`20261014062241_add_request_responses`, generated client committed);
`RequestsModule` extended — vendor `POST /product-requests/:id/responses`
(SUPPLIER+AGRO_DEALER; request must be OPEN, duplicate → 409),
buyer-owner `GET .../responses` (foreign → 404), vendor
`GET /product-requests/responses/mine`, actor-scoped
`PATCH /product-requests/responses/:id` (vendor WITHDRAWN / buyer
ACCEPTED|DECLINED; accept runs one transaction that auto-declines competing
OPEN responses, then best-effort notifies the vendor via a new
`NotificationsService.onRequestResponseAccepted`); public board payload gained
a filtered `_count` of live responses (no identity). Web: vendor hub
"Buyer requests" gained per-request **Respond** (message + optional quote)
and a **My responses** panel with status chips + withdraw; `/requests` gained
per-request **View responses (n)** expand with Accept/Decline (accepting
locally closes the others to mirror the server transaction) and verified-badge
business names; landing `#requests` cards show the interested-supplier badge
(live-only count: OPEN + ACCEPTED responses, so an accepted-then-closed field
reads 1, not the historical total — verified in the live journey). Smoke
**H1–H3** — one smoke bug found and fixed on the way: the "buyer cannot
withdraw a response" check mistakenly used the dealer token (owner), which
correctly 409s on a state check; split into buyer-wrong-actor 404 +
vendor-re-act 409 (stronger coverage). Suite now **8 acceptance flows,
124 ✓**. Live journey 2026-10-14 (same approved buyer@ temporary-demote,
purges its own leftover requests, restored to SUPPLIER and re-verified):
both vendors respond → duplicate 409 → buyer accepts dev@ → dealer@ auto-
DECLINED → acceptance notification visible to dev@ → live-only interested
count → guards (foreign-vendor withdraw 404, owner-on-ACCEPTED 409, anon 401,
buyer respond 403) → request withdrawn → late respond 409 → `/`, `/requests`,
`/supplier` all 200. Two live-script bugs on the way (both in the script, not
the API): the count assertion expected the historical total, and the
wrong-actor check reused the owner token — same class of bug as the smoke one,
same fix pattern.

### CP10 — Cart & multi-item checkout
Extra gates:
- Unit tests: cart add (creates / increments / stock cap → 400 / inactive →
  400 / no inventory → 400 / unknown → 404), owner-only update+remove
  (foreign/unknown → 404, cap → 400, delisted → 409), clear, checkout
  (splits one order per supplier under a shared orderGroupId, reserves each
  item's quantity, writes history rows, clears the cart; non-buyer → 400,
  foreign address → 404, empty cart → 400, short stock → 409 naming the item,
  delisted → 409, nothing written on rollback).
Role journey (deployed): buyer adds one product from each of two suppliers →
cart drawer shows both grouped by supplier with live caps → `/checkout`
preview shows two order cards → "Place 2 orders" → two PENDING orders sharing
one orderGroupId → buyer orders list renders them under one group header →
inventory reserved for both products → cart empty.

Status **done** (`0475e89`, live journey 2026-10-14 below): 135 API unit tests
(+16); new **`CartItem`** model (`@@unique([userId, productId])` — one line
per product, add = increment; cascade on user/product delete) + **`Order.
orderGroupId?`** (indexed) + migration `20261014073321_add_cart`, generated
client committed; new **`cart/`** module — `GET /cart` (per-line live caps,
lineTotal, inStock flag), `POST /cart/items` (ACTIVE + inventory + combined
quantity cap), `PATCH`/`DELETE /cart/items/:id` (owner-only, foreign/unknown
→ 404), `DELETE /cart`, and `POST /cart/checkout`: validates buyer + address,
re-checks stock for every line (any short item → **409 naming it**, whole
transaction rolls back), groups lines by `supplierId` and creates **one order
per supplier** under one `orderGroupId` in a single transaction (inventory
reservations, status history, cart cleared) — existing single-supplier
lifecycle/transitions/disputes/notifications work per order untouched.
Web: header **Cart** button with count badge (BUYER) + right-side **drawer**
(per-supplier groups, qty steppers, remove, clear, subtotal, "N orders will
be placed — one per supplier"), **Add to cart** in the product modal beside
"Start order" (on success closes the modal and opens the drawer), new
**`/checkout`** page (address picker + manage link, per-supplier order
cards, optional delivery notes, summary sidebar "Place N orders", success
screen with order numbers), buyer `#orders` list renders each `orderGroupId`
as one block with a "Multi-supplier checkout" header + combined total.
Smoke **I1–I4** — suite now **9 acceptance flows, 126 ✓**.

Live journey **green 2026-10-14** (API run + browser run + self-cleanup):
- *API run*: preflight `GET /cart` anon → **401** proved the CP10 build was
  deployed → buyer@ temporarily demoted via Neon → two fresh ACTIVE listings
  created (dev@ vegetables R12/kg ×10, dealer@ tools R30 ×10) → address +
  clean cart → added 2 × A + 3 × B → checkout returned **2 PENDING orders
  under one orderGroupId with totals R24 + R90** → cart `[]` →
  `reservedQuantity` 2/3 on the fresh products → buyer order list carried the
  shared group id → guards: anon add 401, vendor add 403, over-stock 400,
  empty-checkout 400, unknown-item patch 404 → web `/checkout` 200, `/` 200.
- *Browser run* (buyer@ demoted again): logged in → header **Cart** badge
  (0 → 2 items) → product modal **Add to cart** → drawer showed both lines
  grouped by supplier (`Limpopo Agro Equipment` / `BonAgri Farm`) with
  steppers, line totals, **Subtotal R42.00** and "**2 orders will be placed —
  one per supplier**" → `/checkout`: address picker (default pre-selected),
  two per-supplier order cards with subtotals, summary sidebar → **Place 2
  orders** → success screen "**2 orders placed**" listing
  `BON-20261014-159232` (R30, Limpopo Agro Equipment) + `BON-20261014-327708`
  (R12, BonAgri Farm) → `#orders` rendered the "**Multi-supplier checkout • 2
  orders • combined R42.00**" group header over both orders. Screenshots
  captured (checkout page, success screen).
- *Self-cleaning*: purge deleted the journey's orders, `cp10-live-%` products,
  the CP10 Live address and cart rows; post-run verify = buyer@ **SUPPLIER**,
  residue **0/0/0/0** — this time no prod leftovers (improvement over CP6/CP9
  residue).

### CP11 — Manual EFT payments + invoices

**Landed** `4a6067b` (code) + docs commit. **No migration** — the `Payment`
(`orderId @unique`, MANUAL/PENDING/amount/transactionRef/paidAt) and `Invoice`
(`orderId @unique`, `invoiceNumber @unique`, totals, issuedAt) models shipped
dormant in CP0; CP11 activates them.

**API** (both routes in `orders/`, DTOs `record-payment.dto.ts` /
`verify-payment.dto.ts`):
- `POST /api/orders/:id/payment` — **BUYER**, order owner only (foreign/missing
  → 404), order must be **PENDING** (else 409). Body `{transactionRef}` (trimmed,
  ≥3 chars). Creates `Payment` provider `MANUAL`, status `PENDING`,
  `amount = order.total`. Duplicate while pending → 409; already `PAID` → 409;
  after `FAILED` the same POST **re-records** (back to `PENDING` with the new
  ref). Evidence only — the order status never moves here.
- `PATCH /api/orders/:id/payment` — **SUPPLIER/AGRO_DEALER/ADMIN** (RolesGuard);
  supplier must own an item of the order (else 404). Body `{status: PAID |
  FAILED}`. No payment → 409; `PAID` → 409 on repeat; `FAILED` → 409 on repeat.
  `PAID` stamps `paidAt`, `FAILED` clears it; after the decision the buyer gets
  an `onPaymentDecision` notification (row + best-effort email — "Payment
  received…"/"Payment check failed…"). Payment stays evidence, not authority:
  only the supplier's `PATCH /:id/status` advances the order.
- **Invoice on first CONFIRMED**: inside the existing `updateOrderStatus`
  transaction, right after stock consumption — `tx.invoice.upsert({ where:
  { orderId }, create: { invoiceNumber: "INV-" + order.orderNumber, …totals },
  update: {} })`. `orderId @unique` + empty update = idempotent.

**Web**:
- Buyer `#orders` card: payment chip (**Paid via EFT / EFT awaiting check /
  EFT ref rejected**) next to the status chip; "I've sent the EFT" inline form
  (ref input → Submit) while PENDING, "Re-record EFT" after a rejection, and an
  "EFT recorded — awaiting supplier check" hint once submitted.
- `/orders/[id]`: new **Payment** section — chip, `Manual EFT · R… · reference
  …`, verified timestamp or "recorded — supplier will match it" note; the buyer
  record/re-record form pre-confirmation; invoice link once issued.
- `/supplier` order card: **Manual EFT payment** panel (status chip, amount,
  ref, verified date) with **Verify payment** / **Reject reference** buttons
  while pending — plus an invoice link after confirmation.
- New **`/orders/[id]/invoice`** printable page (AuthGuard all four roles, API
  still enforces ownership): TAX INVOICE header + `INV-…` number/issue date,
  from (supplier business) / bill-to (delivery recipient), items table,
  subtotal/fee/total, payment line (status + ref), footer note;
  `Print / save PDF` button + `print:` CSS (no PDF library).

**Gates**: api build ✓ / lint ✓ (only pre-existing mail warnings) / test
**157 passed** (+22: 19 orders + 3 notifications); web build ✓ (`/orders/[id]/invoice`
listed) / lint ✓; smoke **J1–J3** — suite now **10 acceptance flows, 128 ✓**,
exit 0.

Live journey **green 2026-10-14** (API run + browser run + self-cleanup):
- *API run*: deploy preflight `POST /orders/:id/payment` anon → **401** (old
  build would 404) → buyer@ temp-demoted → fresh listing (dev@ R20 ×6) + address
  + R40 order → record ref → `MANUAL/PENDING/R40`, order **stays PENDING**,
  no invoice, duplicate → 409 → guards anon 401/401, vendor 403, buyer verify
  403, foreign (dealer) 404 → supplier verify → `PAID` + `paidAt`, buyer
  notification row present → confirm → **`INV-BON-20261014-231184`** with
  R40/R0/R40, payment still PAID → re-verify 409, re-record 409 → web
  `/orders/<id>/invoice` 200, `/` 200. Trap restored role + purged: verify =
  buyer@ **SUPPLIER**, residue **0/0/0/0** (orders/products/address/notifications).
- *Browser run* (buyer@ demoted again): logged in → order card "I've sent the
  EFT" → inline ref `EFT-UI-7734291` submitted → chip **EFT AWAITING CHECK** +
  "EFT recorded — awaiting supplier check" → detail page Payment section
  (ref + "supplier will match it" note, no invoice link yet) → logged in as
  dev@ → supplier hub payment panel (Awaiting check, Verify/Reject) → **Verify**
  → chip **Verified** + "Verified 14 Oct 2026, 15:57" while the order still
  showed "Next step: Confirmed" (evidence ≠ authority) → **Confirm** →
  "Invoice INV-BON-20261014-238624 — open printable view" link appeared →
  invoice page rendered TAX INVOICE (BonAgri Farm → Live Tester, 2 kg × R20,
  R40/R0/R40, "Paid via EFT (verified…) ref EFT-UI-7734291", Print button) →
  back to buyer@: card shows **CONFIRMED + PAID VIA EFT**, detail shows the
  verified line + invoice link. (Screenshots unavailable this run — desktop
  visibility; DOM probes used as evidence.)
- *Self-cleaning*: role restored + `CP11 UI live` order, `cp11-ui-%` product,
  CP11 Live address and journey notifications purged; verify = **SUPPLIER**,
  residue **0/0/0/0**.

### CP12 — Delivery tracking

**Landed** `d8e180c` (code) + `b9cc976` (live-journey fix) + docs commit. **No
migration** — the `Delivery` model (`orderId @unique`, `DeliveryStatus` enum,
`trackingNumber @unique`, driver fields, `estimatedDate`, `pickedUpAt` /
`deliveredAt`) shipped in CP0 and was already upserted on transitions; CP12
makes OUT_FOR_DELIVERY a real tracked step instead of a bare enum flip. (The
plan's "dead since CP0" note was wrong — the row was live; CP12 extends it.)

**API** (`orders/`, extended `UpdateOrderStatusDto`):
- `UpdateOrderStatusDto` gains optional `driverName` (2–80), `driverPhone`
  (5–30), `estimatedDate` (ISO date), `trackingNumber` (3–60). Delivery details
  on **any other transition → 400** ("can only be set when marking an order out
  for delivery"); blank/whitespace-only values are treated as absent.
- The **OUT_FOR_DELIVERY** upsert now writes `status ASSIGNED` (was IN_TRANSIT)
  + the provided fields + `pickedUpAt` (unchanged semantics: goods handed to
  the driver). A `trackingNumber` already held by another order's delivery →
  **409** (pre-checked inside the transaction). **DELIVERED** keeps syncing
  `DELIVERED` + `deliveredAt`; the update branch is partial so driver fields
  survive. READY_FOR_DELIVERY still creates the row `PENDING`. `PICKED_UP` /
  `IN_TRANSIT` / `FAILED` stay unused (reserved for a future driver app — no
  order status exists between OUT_FOR_DELIVERY and DELIVERED).
- New **`GET /api/orders/:id/delivery`** — any authenticated user; the service
  re-checks ownership: buyer owner, a supplier of one of the order's items, or
  ADMIN; anyone else → **404** (no existence leak). Order exists but has no
  delivery row yet → **404**.

**Web**:
- `/supplier`: **"Mark out for delivery"** opens an inline **Delivery details**
  form (driver name\*, phone\*, expected date\*, tracking number optional)
  instead of a bare status flip; required-field validation surfaces in the page
  error banner; submit PATCHes status + details; other statuses keep the
  one-click button. Cards with a driver also render a **Delivery tracking**
  strip (On the way / Delivered badge, driver · tracking · expected date,
  delivered timestamp).
- Buyer `#orders` card: green strip **"Out for delivery · Driver … · Tracking
  … · Expected …"** once the delivery row carries a driver.
- `/orders/[id]`: new **Delivery tracking** section — chip (On its way /
  Delivered / failed), driver + phone, tracking number, expected date,
  picked-up + delivered timestamps, "preparing for dispatch" note while the row
  is PENDING. The status-history timeline was already on this page since CP0
  (the plan's "timeline on the buyer order card" requirement).

**Gates**: api build ✓ / lint ✓ (only pre-existing mail warnings) / test
**171 passed** (+14: 6 transition-details tests + 8 `getDelivery` guard tests);
web build ✓ / lint ✓; smoke **K1–K2** — suite now **11 acceptance flows,
130 ✓**, exit 0.

Live journey **green 2026-10-18** (API run + browser run + cleanup):
- *API run*: deploy preflight `GET /orders/:id/delivery` anon → **401** (the old
  build 404'd the unknown route — new build live) → guards anon 401 / foreign
  (dealer) 404 / no-row 404 / details-on-CONFIRMED **400** (order left PENDING,
  no delivery row created) → walk to READY_FOR_DELIVERY (`INV-BON-20261018-780104`
  issued at CONFIRMED; delivery row `PENDING`, no driver) → OUT_FOR_DELIVERY
  with Lwazi Dlamini / 071 234 5678 / 2026-10-20 / **TRK-LIVE-1792304516** →
  `ASSIGNED` + `pickedUpAt`, no `deliveredAt`; buyer **and** owning-supplier
  delivery views → 200 → second order reusing the same tracking → **409** →
  DELIVERED → `DELIVERED` + `deliveredAt`, driver/tracking/invoice retained →
  web `/orders/<id>` 200. Self-cleaning trap fired.
- *Browser run* (staged order `BON-20261018-260420` at READY_FOR_DELIVERY):
  dev@ → "Mark out for delivery" → empty submit → client validation error,
  order untouched → filled form (Sipho Mahlangu / 083 765 4321 / 19 Oct /
  `TRK-UI-1792304600`) → submit → strip **On the way · Sipho Mahlangu ·
  TRK-UI-1792304600 · expected 19 Oct**, chip OUT FOR DELIVERY, action →
  Delivered → buyer@: landing strip "Out for delivery · Driver … · Expected
  19 Oct" + detail section (On its way, driver + phone, tracking, expected,
  picked up 08:27) → dev@: **Delivered** → chip + strip badge Delivered +
  "Delivered 18 Oct 2026, 08:30", no buttons left → buyer detail shows the
  Delivered chip + delivered timestamp.
- *Live-caught fix*: the supplier strip initially rendered the date-only
  `estimatedDate` through the timestamp helper ("expected 19 Oct 2026, 02:00"
  — a UTC-midnight artifact); fixed in `b9cc976` (date-only, like the buyer
  surfaces), rebuilt + redeployed and re-verified on prod ("expected 19 Oct").
- *Cleanup*: role restored + CP12 live/UI orders, `cp12-%` products, CP12
  addresses and journey notifications purged; verify = buyer@ **SUPPLIER**,
  residue **0|0|0|0** (+ notification residue by all three journey order
  numbers = **0**, corrected read-only check after the script's own
  verification SELECT used `USING` — a DELETE-only clause — and errored
  harmlessly; the deletes themselves had already run).

### CP13 — Trust & ops hygiene (CI, rate limiting, e2e fix)

**Landed** `385034a` (feat) + `c25f1eb` (actions v5) + `7890119`/`bc48443`/`a0c19be`
(rate-limit trust-proxy diagnosis + fix) + docs commit. **No migration.** Scope
confirmed for this CP: the ops bundle — CI pipeline, the long-broken e2e suite,
and rate limiting. Reviews UI and refresh tokens are **deferred** to later
checkpoints.

**CI** (`.github/workflows/ci.yml`, Node 24, actions v5; on push to `main` +
PRs):
- `api` job: `npm ci` → build → lint → test.
- `web` job: `npm ci` → build (with `NEXT_PUBLIC_API_BASE_URL` placeholder) →
  lint.
- `smoke-syntax` job: `bash -n scripts/runtime-smoke.sh`.
- Verified green on GitHub (5 consecutive runs; latest api 31s / web 36s /
  syntax 6s; only pre-existing `mail.service` lint annotations).

**E2E fix** (`api/test/`): two independent faults — `test/jest-e2e.json` had no
`moduleNameMapper` for the generated Prisma client's `.js`-relative imports
(root cause of `Cannot find module './internal/class.js'`), and the starter
spec still asserted `GET /` → "Hello World!" which no longer exists. Added
`moduleNameMapper` (`^(\.{1,2}/.*)\.js$` → `$1`) and rewrote the spec to assert
`GET /` → 404 (global prefix) and `GET /api/health` → 200
`{status:'ok',service:'bonagri-api',database:'connected'}`. `npm run test:e2e`
→ **2 passed** (was exit 1).

**Rate limiting** (`@nestjs/throttler` v6.7.1):
- `ThrottlerModule.forRoot` in `app.module.ts`: default **120 req/min** per
  client, `errorMessage: "Too many requests — please slow down and try again
  shortly"`, `setHeaders: true` (exposes `X-RateLimit-*`).
- Controller-level `ThrottlerGuard` on `auth`, `catalog`, `requests`; per-route
  `@Throttle` budgets on auth: **login 15/min**, register 10/min, verify-email
  15/min, resend-verification 5/min; `/auth/me` keeps the 120 default; health
  intentionally unthrottled (UptimeRobot probes).
- `main.ts` sets **`trust proxy: 3`** — the value that makes the limiter key on
  the real client IP behind Render's proxy chain (see live journey). The
  reasoning is pinned in a code comment: 1–2 trusts Render/Cloudflare hops and
  keys on per-request edge IPs (scattered buckets → limiter never fires, the
  exact production symptom observed at trust 1 and 2); 3+ becomes spoofable
  (client-prepended `X-Forwarded-For` entries would rotate buckets). Exactly 3
  is both stable and spoof-safe.
- New unit spec `auth.rate-limit.spec.ts` (+2): 15 logins then 429; per-route
  bucket isolation (login ≠ register).

**Gates**: api build ✓ / lint ✓ (only pre-existing mail warnings) / test
**173 passed** (+2) / e2e **2 passed** (fixed); web build ✓ / lint ✓; smoke
**L1–L3** — suite now **12 acceptance flows, 134 ✓**, exit 0.

Live journey **green 2026-10-19** (API run + browser run; login-only flows, no
DB writes anywhere — nothing to trap/restore/purge):
- *API run*: deploy preflight showed `X-RateLimit-Limit: 15` on login (throttler
  live but mis-keyed) → 16-attempt wrong-password hammer returned 401s with a
  **non-monotonic** `X-RateLimit-Remaining` (requests split across buckets —
  `req.ip` was a per-request Cloudflare edge IP at trust 2) → diagnosis
  middleware (`bc48443`) captured the ground truth: `X-Forwarded-For:
  <client>, <cloudflare-edge>, <render-internal>` (3 hops, Cloudflare in the
  path; client prepends land *left* of the real client) → trust **3**
  (`a0c19be`) → re-hammer: monotonic 14→0, **429 at attempt 16** with the
  friendly message; scope check during throttle: health 200 / products 200 /
  anon `/auth/me` 401 (unaffected routes); **spoof resistance**: rotated
  `X-Forwarded-For` values during the window still → 429 (bucket = real
  client); **recovery**: window reset → login → 201 with a valid token.
- *Browser run* (`bonagri-web`): dev@ wrong password → "Invalid email or
  password" banner (normal error path intact) → API hammer exhausts the shared
  bucket → dev@ **correct** password in the UI → banner **"Too many requests —
  please slow down and try again shortly"** (throttler message surfaces through
  the existing error banner) → wait out the window → correct password →
  redirected to `/supplier` (Supplier Operations hub renders, 7 total orders).

### CP14 — Transporter role (delivery jobs)

**Status**: pending — design approved 2026-10-19 (spec for implementation).

**Why it fits**: today the supplier is simultaneously seller and courier — it
drives `READY_FOR_DELIVERY → OUT_FOR_DELIVERY → DELIVERED` and types driver
details by hand (CP12's free-text fields). The transporter takes over exactly
the **courier half** of that job. The `Delivery` status enum already contains
`PICKED_UP` / `IN_TRANSIT` / `FAILED`, explicitly reserved by CP12 "for a
future driver app" — this checkpoint activates them. **No `OrderStatus` change.**

**Decisions (confirmed with product owner)**:
- **Assignment = publish + claim**, not dispatch: at `READY_FOR_DELIVERY` the
  supplier *publishes* the job; verified transporters whose service area covers
  the delivery province see it on a claim board and claim it (atomic).
  Supplier-picks-a-transporter (direct dispatch) is **out** — double-booking
  two suppliers onto one transporter is unsolvable without capacity
  calendars; under claim, transporters self-select against their own queue.
  Mirrors the platform's existing interaction: buyers post requests,
  suppliers respond (CP7/CP9); now suppliers post delivery jobs,
  transporters respond.
- **Onboarding = admin promote only** (no application model): admin promotes a
  buyer → `TRANSPORTER` creating a `TransporterProfile` (mirrors
  `promoteToSupplier`), and manages the `verified` flag. Only verified
  transporters see/claim jobs. Self-serve application deferred until there is
  real transporter demand.
- **Full state machine**: assign/publish → pickup → in-transit → complete /
  fail (+ re-dispatch) with notifications. No deferrals — FAILED→re-dispatch
  is what makes the flow logically closed (a failed delivery must not strand
  the order).

**Out of scope (explicit)**: transport fees/money (agreed off-platform; no
`Payment`/`Invoice`/`deliveryFee` changes), route optimization, transporter
payouts, self-serve transporter application, distance-based fees, capacity
limits per transporter, direct dispatch.

**Schema (one migration)**:
- `UserRole` += `TRANSPORTER`.
- New `TransporterProfile` (mirrors `SupplierProfile`): `userId @unique`,
  `businessName`, `vehicleType?` (e.g. bakkie/van/truck), `phone?`, `email?`,
  `city?`, `province?`,
  `serviceProvinces String[]` (job board filter), `verified @default(false)`,
  `user` relation (Cascade), timestamps + indexes on `verified`/`province`.
- `Delivery` += `transporterId String?` (relation → `TransporterProfile`,
  indexed; **null = self-delivery = today's behaviour, untouched**),
  `publishedAt DateTime?`, `failedReason String?`, `failedAt DateTime?`.
- No `TransportApplication` (admin-promote decision above).

**State machine** (all actions one transaction, ownership re-checked in the
service; delivery-side states in **bold**, order transitions on arrows):

| Action | Actor | Delivery | Order |
|---|---|---|---|
| Publish job | owning supplier / admin (order at READY_FOR_DELIVERY, delivery PENDING, unclaimed) | stamp `publishedAt` | unchanged |
| Unpublish (before any claim) | owning supplier / admin | clear `publishedAt` | unchanged |
| Claim | verified TRANSPORTER (board = published ∧ unclaimed ∧ province ∈ `serviceProvinces`) | atomic `PENDING → ASSIGNED` + `transporterId` (conditional update; loser → **409**) | unchanged |
| Pick up | assigned transporter | → **PICKED_UP**, stamp `pickedUpAt` once (never overwritten) | READY_FOR_DELIVERY → **OUT_FOR_DELIVERY** (skipped if already OUT — re-dispatch retry case) |
| In transit | assigned transporter | → **IN_TRANSIT** | unchanged |
| Complete | assigned transporter | → DELIVERED, `deliveredAt` | → **DELIVERED** (invoice already issued at CONFIRMED) |
| Fail (+reason) | assigned transporter | → **FAILED** + `failedReason`/`failedAt` | unchanged |
| Re-dispatch | owning supplier / admin (only from FAILED) | with `transporterId?` → FAILED → **ASSIGNED** (same or different transporter, notified); omitted → back to unclaimed **PENDING** (re-publish or self-deliver); failed fields kept as audit | unchanged |
| Self-delivery (delivery has no `transporterId`) | owning supplier | exactly CP12's current behaviour | current behaviour |

**Ownership handoff rule** (the core invariant): while
`delivery.transporterId` is set, the supplier is **locked out** of the
`OUT_FOR_DELIVERY` and `DELIVERED` order transitions (→ 403) — the assigned
transporter drives those two steps; ADMIN always overrides. Before
assignment, nothing changes. Two actors never drive the same delivery.

**Failure closure**: *pickup failure* → order still READY_FOR_DELIVERY →
from FAILED, re-dispatch **with** a transporter keeps the supplier locked out
(self-delivery only via the admin path until then); re-dispatch **without**
one clears `transporterId` → back to unclaimed PENDING → supplier may
re-publish or self-deliver (CP12 path). *Delivery failure* → order stays
OUT_FOR_DELIVERY (no backward transitions anywhere) → re-dispatch (transporter
or clear + supplier completes it himself) or buyer opens the existing CP5
dispute (eligible from OUT_FOR_DELIVERY). Goods-return-to-supplier is
recorded by FAILED + reason, not by an order status.

**API — new `transport/` module** + two actions on `orders/`:
- `GET /transport/jobs` — open board (TRANSPORTER, verified): city-level only
  (pickup city, dropoff city, item count, published age) — **full delivery
  address + buyer phone unlock only in the claimed job**, via
  `GET /transport/deliveries` (mine: active + history).
- `POST /transport/jobs/:orderId/claim` — atomic claim (409 on race).
- `POST /orders/:id/delivery/publish` · `DELETE .../publish` — supplier/admin;
  409 if already claimed, 400 unless order READY_FOR_DELIVERY.
- `PATCH /orders/:id/delivery/pickup | transit | complete | fail {reason?}` —
  assigned transporter only (unassigned/foreign → 404, no existence leak);
  each drives the order transition per the table inside one transaction.
- `POST /orders/:id/delivery/re-dispatch {transporterId?}` — supplier/admin,
  FAILED only → 409 otherwise; omitted `transporterId` returns to unclaimed
  PENDING (re-publishable or self-deliverable).
- `GET /transporters` — verified list (businessName, city, vehicleType,
  serviceProvinces, verified badge) for the supplier's re-dispatch dropdown.
- Existing `GET /orders/:id/delivery` widens to the assigned transporter.
- Guard additions: `@Roles("TRANSPORTER")` on transport routes; the supplier
  lockout inside `orders.service.updateOrderStatus`.

**Notifications** (reuse `NotificationsService` best-effort email + row
pattern): job **published** → row to each verified transporter whose
`serviceProvinces` cover the delivery province; **claimed** → row + email to
the supplier; **picked up** → row to the buyer ("your order is on the way" —
currently missing); **failed** → row + email to buyer **and** supplier;
**re-dispatched to a specific transporter** → row + email to that transporter
("job assigned to you"; re-dispatch back to the open board re-publishes, so
the publish fan-out applies again). DELIVERED already notifies the buyer.

**Web**:
- New **`/transport`** hub (AuthGuard accepts TRANSPORTER): claim board
  (city-level cards, Claim button → 409 handling "just claimed by someone
  else"), My deliveries (Pick up / In transit / Delivered / Failed actions,
  full address + buyer contact only here), history. Header link for
  TRANSPORTER role only; `/supplier/**` stays closed to transporters.
- **Supplier hub**: at READY_FOR_DELIVERY — "Publish to transporters" /
  "Unpublish" beside the existing self-delivery form; once claimed, status
  buttons for that order render read-only "With ⟨transporter businessName⟩
  since …" (lockout made visible); after FAILED — "Re-dispatch" (transporter
  dropdown incl. "back to open board") or self-deliver.
- **Buyer**: tracking strip + `/orders/[id]` gain PICKED_UP / IN_TRANSIT /
  FAILED chips; FAILED shows the reason + "raise a dispute" nudge (existing
  CP5 form).
- **Admin**: `/admin/transporters` list + verify toggle (mirrors supplier
  verify) + "Promote to transporter" on the users screen (mirrors
  `promoteToSupplier`, creates profile exactly once).

**Gates** (standing): migration + committed regenerated client; unit tests
(claim atomicity/409, lockout 403, pickup skips order flip on retry, publish
scope, fail/re-dispatch transitions, guards); smoke **section M** (publish →
board visibility filtered by service province → claim → pickup → in-transit →
complete + FAILED → re-dispatch path + guards: anonymous 401, unverified
transporter 403, foreign supplier 404, buyer 403); web build/lint; deployed
API + browser journey; docs commit. Prod bootstrap for the journey: promote a
dedicated user to TRANSPORTER via admin (role is single-valued — never
re-role dev@/buyer@/dealer@).

**Live-journey sketch** (to finalize during implementation): admin promotes a
journey-dedicated account (register+verify fresh user on prod, or reuse a
non-demo account) → verified → supplier walks an order to READY_FOR_DELIVERY
and publishes the job → transporter claims (anonymous/other-transporter sees
nothing → 409 race proof) → pickup flips order OUT_FOR_DELIVERY + buyer strip
→ in-transit → complete → DELIVERED + invoice intact → FAILED path on a
second job → re-dispatch → browser legs: supplier publish/lockout UI,
transporter hub actions, buyer chips.

## 4. Checkpoint hygiene rules

1. One phase = one PR-sized commit series ending in a green CP; no drive-by refactors.
2. Migrations are append-only; regenerate and **commit** `api/src/generated/prisma/`.
3. Extend `scripts/runtime-smoke.sh` in the phase that adds the endpoints it covers —
   the smoke script is the living acceptance suite.
4. If a checkpoint reveals a blocker, record it in `IMPLEMENTATION_PLAN.md` §5 Risks
   before continuing.
5. Production (Render/Neon) is only ever moved forward by push; verify the live
   journey at every CP — local green is not a checkpoint.
