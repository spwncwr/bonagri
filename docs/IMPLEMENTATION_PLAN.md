# BonAgri — Platform Expansion Implementation Plan

Status: **approved for planning — awaiting Phase 0 start**
Companion document: `docs/CHECKPOINT_PLAN.md` (per-phase gates and verification)

## 1. Goal

Turn the deployed MVP (buyer marketplace + supplier order queue + inventory screen)
into the full role-based platform the project was scoped for:

1. **Supplier listing screens** — suppliers manage their product listings (create/edit/
   activate), not just stock levels. The API for this already exists but has no UI.
2. **Four distinguished roles** — CONSUMER (internally `BUYER`), `SUPPLIER`, `ADMIN`,
   `AGRO_DEALER`, each landing on its own role-based screens after login.
3. **Full buy→deliver flow** — buyer journey (browse → order → track → cancel/receive)
   and supplier/dealer journey (list → receive → fulfil → deliver) complete end to end.
4. **Admin** — platform management (users, supplier verification, categories, orders),
   plus **disputes** handling.
5. **Agro dealers** — a vendor role that lists agricultural tools/equipment through the
   same marketplace and order machinery.

## 2. Investigation findings (ground truth, verified 2026-10-13)

### 2.1 Roles today

| Role | Exists in enum | Can register | Has screens | Notes |
|---|---|---|---|---|
| BUYER | yes | yes (public) | `/` marketplace + checkout modal + My Orders | works end to end |
| SUPPLIER | yes | **no** (seed/admin only) | `/supplier` queue, `/supplier/inventory` | **no listing UI** despite API existing |
| ADMIN | yes | no | **none** | `@Roles("ADMIN")` allowed on some routes but services reject admins (`PROJECT_AUDIT` #7) |
| AGRO_DEALER | **no** | — | — | needs enum migration |

`AuthGuard` (`web/components/auth/auth-guard.tsx`) supports a single exact `requiredRole`;
login routes only `SUPPLIER → /supplier`, everyone else → `/`.

### 2.2 API surface relevant to this work

- **Exists, unused by UI**: `POST /api/products`, `PATCH /api/products/:id` (incl. status/
  price — the entire listing-management backend), buyer order cancel
  (`orders.service.ts:263-272`, PENDING-only), `Address` create/list
  (no update/delete endpoints), `SupplierProfile.verified` flag,
  `UserStatus.SUSPENDED` (enforced at login, nothing can set it),
  and whole unused schema models: `Payment`, `Delivery`, `Invoice`, `Notification`.
- **Missing**: any `/admin/*` endpoints; dispute model/endpoints; order status history
  (audit #9 — prerequisite for timelines, audit trail and dispute evidence);
  address update/delete; supplier self-registration/application.

### 2.3 Schema assets to leverage (avoid schema earthquakes)

- `Product.supplierId → SupplierProfile` — the vendor entity. Agro dealers will reuse it
  (see decision D2) instead of adding a parallel vendor table.
- `Product.unit` is a free string — "kg" for produce, "each"/"bag" for tools: no schema
  change needed for tool listings.
- `Delivery`, `Notification` models are ready and unused.

### 2.4 Debts that block or degrade the requested features (from `PROJECT_AUDIT.md`)

| # | Debt | Impact on this work |
|---|---|---|
| 7 | Admin allowed by guards but rejected in services | must fix in Phase 0/3 |
| 8 | Supplier cancel button always rejected (broken UX) | fix in Phase 1 (remove; buyer gets cancel in Phase 2) |
| 9 | No status history/audit trail | add `OrderStatusHistory` in Phase 0 — timelines + disputes depend on it |
| 10 | Single-product orders | accepted for this scope (cart = separate future project) |
| 14 | `GET /products/:id` leaks DRAFT/INACTIVE | fix in Phase 1 alongside listing UI |
| 15 | 1,555-line `page.tsx`, no shared API layer | new screens follow existing per-page pattern; shared-lib refactor explicitly out of scope |

## 3. Design decisions

| ID | Decision | Chosen approach | Alternatives rejected |
|---|---|---|---|
| D1 | Consumer naming | Keep enum value `BUYER`; use "Consumer" only in UI copy | Renaming enum `BUYER→CONSUMER`: churn across api/web/scripts/seed for zero behavior gain |
| D2 | Agro dealer vendor entity | Agro dealer users get a `SupplierProfile` row like suppliers; the distinction lives in `User.role`. New categories ("Agricultural Tools & Equipment", "Seeds & Chemicals") separate the wares | Separate `Dealer`/vendor table (duplicate FK graph); `Product.kind` column (unnecessary — category + role already distinguish) |
| D3 | How roles are assigned | Self-registration stays BUYER-only. **Admin panel promotes users** to SUPPLIER/AGRO_DEALER (and creates their vendor profile on promote). Self-serve "apply to sell" flow deferred to Phase 6 | Open role selection at registration (abusable); approval workflow up front (more schema + UI before any value ships) |
| D4 | Admin bootstrap | Seed creates admin only when `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` env vars are present (never hard-code; never reuse the public dev password). Render + local `.env` each get their own value | Hard-coded demo admin password (public repo rule violation) |
| D5 | Vendor hub routing | One hub at `/supplier/**` serving both SUPPLIER and AGRO_DEALER (AuthGuard `allowedRoles`), role-specific copy only | Parallel `/dealer/**` route tree (duplicated screens) |
| D6 | Disputes storage | `Dispute` model (1 row per dispute) + `OrderStatusHistory` as evidence trail; `DisputeMessage` thread table deferred | Embedding dispute fields on Order (muddies lifecycle); full threaded messaging (overkill for v1) |

## 4. Phases

Each phase = one reviewable unit ending at a checkpoint (`CHECKPOINT_PLAN.md` CP-n).
Phases 0→6 are ordered so every phase ships something demo-able.

### Phase 0 — Role & audit foundations (schema + plumbing)
- Migration: add `AGRO_DEALER` to `UserRole`; add `OrderStatusHistory` model
  (orderId, fromStatus, toStatus, actorUserId, actorRole, note?, createdAt);
  write a history row from `OrdersService.updateOrderStatus` and `createOrder`.
- Seed: env-gated admin (D4); tools categories seeded (D2 groundwork).
- API: fix admin service-layer rejections (#7) — `GET /orders`, `GET /orders/supplier`
  return platform-wide lists for ADMIN; `GET /orders/:id` detail (owner/supplier/admin).
- Web: `lib/auth.ts` role type + `AuthGuard` gains `allowedRoles: UserRole[]`;
  login routes SUPPLIER/AGRO_DEALER → `/supplier`, ADMIN → `/admin` (placeholder shell).
- Exit: migration applied locally + on Neon, builds green, admin login works.

### Phase 1 — Supplier listing screens (user ask #1)
- API: `GET /api/supplier/products` (own listings incl. DRAFT); fix #14 (public
  endpoints hide DRAFT/INACTIVE).
- Web: `/supplier/products` (table: name, category, price, stock, status, actions) +
  create/edit form (name, category select, description, price, unit, imageUrl, initial
  stock); activate/deactivate toggle; remove the broken supplier Cancel button (#8).
- Exit: supplier creates a listing → it appears on the public marketplace; edit/price/
  status changes reflect immediately.

### Phase 2 — Consumer flow completion (user ask #3, buyer side)
- API: `PATCH /api/addresses/:id`, `DELETE /api/addresses/:id` (+ default handling).
- Web: buyer Cancel button on PENDING orders (backend already supports); `/orders/:id`
  detail page with status timeline (from `OrderStatusHistory`) + delivery address;
  `/addresses` management page (list/add/edit/delete/set-default).
- Exit: full buyer journey demo: browse → order → track timeline → cancel or receive.

### Phase 3 — Admin management (user ask #4, management half)
- API: `GET /api/admin/stats` (users/orders/revenue counts), `GET /api/admin/users`
  (+filters), `PATCH /api/admin/users/:id` (suspend/activate/promote role → creates
  vendor profile on promote, per D3), `GET /api/admin/suppliers` +
  `PATCH /api/admin/suppliers/:id/verify`, `GET/POST/PATCH /api/admin/categories`.
- Web: `/admin` shell + pages: dashboard, users, suppliers (verify toggle), categories,
  orders overview (all orders, filter by status).
- Exit: admin promotes a registered buyer to supplier/dealer; suspends a user and that
  user can no longer log in; verifies a supplier profile.

### Phase 4 — Agro dealers (user ask #2 + #5)
- API: add `AGRO_DEALER` to the `@Roles` sets on listing/inventory/order-queue routes
  (they use the identical vendor endpoints per D2/D5).
- Seed: demo dealer account + tool listings (env-gated like existing dev seed).
- Web: `/supplier` hub renders for dealers (copy: "dealer" wording); marketplace gets a
  Tools/Produce segment control (category-group filter) so tool listings surface
  properly; tool listing form units (each/bag) presets.
- Exit: dealer logs in, lists a tool, buyer orders it, supplier-style fulfilment runs.

### Phase 5 — Disputes (user ask #4, disputes half)
- Migration: `Dispute` model (order unique ref, opener, reason enum NOT_DELIVERED /
  WRONG_ITEM / DAMAGED / OTHER, description, status OPEN→UNDER_REVIEW→RESOLVED or
  REJECTED, resolution note, resolvedBy, timestamps).
- API: `POST /api/orders/:id/dispute` (buyer, from OUT_FOR_DELIVERY/DELIVERED or
  overdue OUT_FOR_DELIVERY), `GET /api/disputes/mine` (vendor side),
  `GET /api/disputes` + `PATCH /api/disputes/:id` (admin resolve/reject); resolution
  emails via existing SMTP service.
- Web: buyer "Open dispute" action on order detail; vendor disputes list; `/admin/disputes`
  queue with resolve/reject + history evidence panel.
- Exit: full dispute lifecycle exercised end to end on the deployed stack.

### Phase 6 — Glue & self-service (budget permitting)
- Notifications: write `Notification` rows + emails on key transitions
  (order confirmed/delivered/cancelled, dispute resolved, verification approved);
  simple notifications list in each hub.
- Self-serve "Apply to sell" page → `SellerApplication` model → admin approval queue
  (promotes per D3).
- Known follow-ups explicitly out of scope here: cart/multi-item orders, payments
  (OZOW/PAYFAST), delivery-driver module, refresh tokens, CI.

### Phase 7 — Product requests (buyer demand, landing-page gap #1)
The landing page's "Post a product request" CTA is a dead button and the whole
`#requests` section is decorative (hardcoded example card); no backend exists.
- **Schema**: `ProductRequest` model — `buyerId`, `title` (product wanted),
  `categoryId?` (optional `Category` relation), `quantity` + `unit`,
  `destinationCity?`, `requiredBy?` (date), `notes?`, `status`
  (`OPEN` → `FULFILLED` | `WITHDRAWN`); migration + committed client.
- **API** (new `requests/` feature folder, house layout):
  - `POST /api/product-requests` (BUYER) — create (OPEN).
  - `GET /api/product-requests?status=OPEN` — **public** (no guard) so the landing
    section shows real demand to anonymous visitors; newest first, capped (e.g. 50).
  - `GET /api/product-requests/mine` (BUYER) — own list incl. closed.
  - `PATCH /api/product-requests/:id` (BUYER owner) — withdraw (OPEN → WITHDRAWN)
    or mark FULFILLED; others' requests → 404; non-OPEN → 409.
- **Web**:
  - Landing `#requests`: CTA routes logged-in buyers to `/requests` (anon →
    `/login`); the example card becomes the **empty-state** — when OPEN requests
    exist, show up to 3 real ones (title, quantity, destination, required-by).
  - New `/requests` page (BUYER guard): post form (title, category select,
    quantity+unit, destination, required-by, notes) + "My requests" list with
    status chips and withdraw/fulfil actions.
  - Vendor hub: read-only "Buyer requests" section (OPEN only) so suppliers can
    spot demand; responding/contact exchange is an explicit follow-up.
- **Gates**: unit tests (create guards, owner-only withdraw, status transitions,
  public list scoping); smoke **G1–G3** (create → public list shows it → withdraw
  removes it from OPEN; anon 401 / non-buyer 403 / foreign withdraw 404).

### Phase 8 — Landing-page wiring (dead buttons → real behaviour)
Pure frontend; every control maps onto capability that already exists.
- **Explore-categories cards** → onClick sets `activeSegment` + `activeCategory`
  (deriving the segment from `SEGMENT_CATEGORIES` membership) and smooth-scrolls
  to `#marketplace` — the filter chips then light up naturally. Derive the card
  list from the same `SEGMENT_CATEGORIES`/`CATEGORY_SLUGS` universe as the chips
  (kills the drift: the hardcoded list is missing Agricultural Tools, Seeds &
  Chemicals, Poultry & Livestock; naive API fetch would leak smoke-test
  categories).
- **"Become a supplier"** → `<Link href="/apply">` (CP6 flow). `/apply` guard
  tweak: vendors (SUPPLIER/AGRO_DEALER) hitting `/apply` redirect to `/supplier`
  instead of bouncing to login.
- **"Learn more"** → smooth-scroll to `#how-it-works` (the section directly
  above answers exactly that); no new page.
- **Footer** → add quick links (Marketplace, Product Requests, How it works,
  Sell on BonAgri, Sign in) reusing the same anchors/routes.
- **Gates**: web build + lint; smoke CTA check (curl the routes → 200); manual
  journey: card click filters+scrolls, CTA lands on `/apply`, anon lands on
  `/login`.

### Phase 9 — Request responses (close the demand-board loop)
CP7 left the explicit follow-up: vendors can see OPEN requests but cannot
respond. Grounded finding: `Notification` + `sendNotificationEmail` (CP6) and
the vendor-hub read-only section already exist — this phase turns it two-way.
- **Schema**: `RequestResponse` model — `requestId`, `supplierId`
  (`SupplierProfile`), `message` (what they can supply), `quotedPrice?
  Decimal(12,2)`, `quotedUnit?` (e.g. "per kg"), `status` (`OPEN` → `ACCEPTED`
  | `DECLINED` | `WITHDRAWN` by vendor), timestamps; unique
  `@@unique([requestId, supplierId])` (one live response per vendor per
  request); migration + committed client.
- **API** (extend `requests/`):
  - `POST /product-requests/:id/responses` (SUPPLIER+AGRO_DEALER) — create;
    request must be OPEN (409 otherwise); duplicate → 409.
  - `GET /product-requests/:id/responses` — **request owner only** (buyer);
    foreign/unknown → 404.
  - `PATCH /product-requests/responses/:id` — vendor withdraws (owner-only),
    or buyer accepts/declines (only their request's responses; accepting marks
    the response ACCEPTED and auto-DECLINEs the rest in one transaction).
  - Accept fires a notification (+ email) to the vendor; decline is silent
    row-state (buyer just declines in UI).
  - Public board payload unchanged (no responses leak anonymously).
- **Web**:
  - Vendor hub "Buyer requests" section: add a **Respond** action (message +
    optional quoted price) per OPEN request; "My responses" list with status.
  - `/requests` page: per-request "View responses (n)" expand — vendor,
    message, quote, date; Accept/Decline buttons; accepted vendor's
    businessName shown.
  - Landing board: show "n suppliers interested" badge (count only — no
    identity pre-accept).
- **Gates**: unit tests (respond guards, owner-only reads, accept transaction
  incl. auto-decline of others, duplicate/409 matrix, non-OPEN 409); smoke
  **H1–H3** (vendor responds → buyer sees + accepts → vendor notified +
  competing response auto-declined; foreign read 404; anon 401; respond to
  WITHDRAWN request 409).

### Phase 10 — Cart & multi-item checkout (single order per supplier)
Biggest UX gap: one product per order. Key design decision: the cart may mix
suppliers, but **checkout creates one `Order` per supplier** (linked by a new
`orderGroupId` column) — the entire existing single-supplier lifecycle
(confirm/ready/deliver, disputes, notifications, invoices) keeps working
untouched per order. Also fixes P0 gap #10 in the audit.
- **Schema**: `CartItem` — `userId`, `productId`, `quantity Int`, `addedAt`;
  `@@unique([userId, productId])`; `Order.orderGroupId String?` (+ index) to
  group split orders; migration + committed client.
- **API** (new `cart/` feature folder):
  - `GET /cart` (BUYER) — items with live product info + stock caps.
  - `POST /cart/items` (BUYER) — add/increment (product must be ACTIVE;
    quantity capped at available stock → 400).
  - `PATCH /cart/items/:id` (BUYER owner) — change quantity (same cap).
  - `DELETE /cart/items/:id`, `DELETE /cart` (BUYER owner).
  - `POST /checkout` (BUYER) — body `{deliveryAddressId, notes?}`: validates
    address ownership, re-checks stock for **every** item, reserves inventory,
    creates one order per supplier with per-supplier delivery fee, writes
    `orderGroupId`, appends `OrderItem` rows, clears the cart — all in one
    transaction; partial stock failure rolls back everything (409 naming the
    short item). Single-item carts behave exactly like today's flow.
- **Web**:
  - Cart badge in header + slide-over/drawer listing items (qty steppers,
    remove, per-supplier subtotal grouping).
  - `/checkout` page (BUYER): address picker (reuse CP2 list + inline add),
    per-supplier order cards with totals, "Place N orders" button, success
    screen listing order numbers.
  - Buyer orders list: group orders from one checkout under one heading
    ("Order group …, 2 orders"); reorder button adds all items back to cart.
  - Landing product modal: "Add to cart" alongside "Order now".
- **Gates**: unit tests (add/cap/dupe, checkout grouping, stock re-check +
  rollback, address foreign 404); smoke **I1–I4** (add 2 products from 2
  suppliers → checkout → 2 orders with same `orderGroupId`, correct totals &
  reservations; over-stock add → 400; foreign cart item 404; lifecycle still
  green via existing S/C sections).

### Phase 11 — Payments (manual EFT + invoices; gateway later)
`Payment`/`Invoice` models + `MANUAL`/`OZOW`/`PAYFAST` enums shipped in CP0 but
are dead — this phase activates them **without a gateway** (no merchant
account, no webhooks, nothing external; free-tier safe). Gateway integration
stays a separate future phase requiring your PayFast/Ozow signup.
- **Model/flow**: pay-on-delivery remains the default. New optional path: buyer
  marks an order "EFT sent" → `Payment` row (`provider MANUAL`, `status
  PENDING`, `transactionRef` = their EFT reference) → supplier verifies →
  `status PAID`, `paidAt` stamped → buyer notified. Unverified-after-72h is a
  supplier judgement call (no auto-cancel in MVP). `Invoice` row generated
  with the first CONFIRMED transition (`invoiceNumber` = derived from
  orderNumber; unique; idempotent).
- **API** (in `orders/`): `POST /orders/:id/payment` (BUYER owner, from
  PENDING — sets order status CONFIRMED only via the existing supplier path;
  payment is evidence, not authority), `PATCH /orders/:id/payment`
  (supplier of that order — verify/reject), buyer+supplier reads of payment
  state via existing order payloads (add `payment`/`invoice` to the includes).
- **Web**: buyer order card — "I've sent the EFT" button + reference input +
  payment status chip; supplier order drawer — payment panel (reference,
  verify/reject); printable invoice view (`/orders/:id/invoice`, browser
  print CSS, no PDF lib).
- **Gates**: unit tests (payment create/verify guards, invoice idempotency,
  foreign 404s, wrong-state 409s); smoke **J1–J3** (order → buyer records EFT
  ref → supplier verifies → PAID + buyer notified; invoice row exists after
  CONFIRMED; guards matrix).

### Phase 12 — Delivery tracking
`Delivery` model also dead since CP0. Out-for-delivery becomes a real tracked
step instead of a bare enum flip.
- **API** (in `orders/`): extending the OUT_FOR_DELIVERY transition accepts
  optional `{driverName, driverPhone, estimatedDate, trackingNumber}` and
  upserts the `Delivery` row (`status ASSIGNED`); later transitions move
  `Delivery.status` (`PICKED_UP`/`IN_TRANSIT`/`DELIVERED` — DELIVERED syncs
  `deliveredAt`); `GET /orders/:id/delivery` (buyer owner or supplier of that
  order) returns the tracking view.
- **Web**: buyer order card shows driver + tracking number + expected date
  when OUT_FOR_DELIVERY; supplier form collects them on "Mark out for
  delivery"; status history timeline (existing `OrderStatusHistory`) rendered
  on the buyer order card.
- **Gates**: unit tests (delivery upsert on transition, sync matrix, read
  guards); smoke **K1–K2** (full lifecycle with delivery fields, delivery row
  synced at DELIVERED; foreign read 404).

### Phase 13 — Trust & ops hygiene
Cross-cutting hardening; small items can ride along with other phases, but the
list is the standing backlog.
- **CI**: GitHub Actions workflow — api (install, build, lint, unit tests),
  web (install, build, lint), `bash -n scripts/runtime-smoke.sh`; runs on PR +
  main push. (Full smoke stays manual — it mutates a DB.)
- **Session security**: access-token expiry (e.g. 12h) + **refresh tokens**
  (httpOnly cookie or stored refresh row with rotation) so stolen localStorage
  tokens age out; forces a web `lib/auth.ts` rework — schedule deliberately.
- **Rate limiting**: `@nestjs/throttler` on `auth/*` and public reads.
- **Reviews**: after DELIVERED, buyer rates the supplier product (1–5 + text,
  one per order-item, `@@unique([orderId, productId])`); aggregate shown on
  product cards; LOW ratings surface in supplier hub (no auto-action).
- **Fix `npm run test:e2e`** (still asserts the dead `GET /` route) or delete
  it honestly.
- **Optional shared web API layer** (`lib/api.ts`) — only if the page count
  keeps growing; explicitly deferred otherwise (audit risk #15).

Recommended order: **9 → 10 → 11 → 12**, with 13's CI item pulled forward
whenever convenient. CP9 is small and completes the CP7 story; CP10 is the
largest single chunk — budget it as its own checkpoint; CP11 deliberately
ships MANUAL-only so real money stays a later, deliberate decision.

## 5. Risks

1. **Neon free-tier migrations** — every phase ships a migration via Render build
   (`migrate deploy`); cold-start P1002 remains the failure mode → redeploy warm
   (established practice from deployment).
2. **Role guard widening** — adding AGRO_DEALER to `@Roles` sets must be done route by
   route, re-verifying ownership checks in services (dealers/suppliers must never see
   each other's private data).
3. **Seed drift on Neon** — idempotent seed + env gates; re-running seed on Neon adds
   new demo rows (admin/dealer) without touching existing data.
4. **Frontend monolith** — new screens are new routes; resist growing `page.tsx`
   further; keep per-page `API_BASE_URL` pattern (house style) even though it's
   duplicated (refactor explicitly deferred).
