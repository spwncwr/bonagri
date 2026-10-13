# BonAgri — Project Audit

_Investigation only. Every claim below was verified by reading code or running read-only commands on 2026-10-12. Items that could not be verified are marked **UNVERIFIED**._

**Important context:** the git working tree contains a large amount of **uncommitted** work (email verification, addresses module, mail module, login/verify-email pages, PWA files, `scripts/`). Last commit: `5ef17e8 feat: secure marketplace APIs with JWT authorization` (2026-10-03). Everything below describes the **working tree**, not HEAD, unless stated.

---

## Update log (post-audit changes)

Platform-expansion checkpoints land on `main` continuously. **Where this audit's body says otherwise, this table supersedes it** (notably the claims that no `OrderStatusHistory` model, no status history, no admin, no real tests, and no smoke run exist). Gates and verification journeys live in `docs/CHECKPOINT_PLAN.md`.

| Date | Checkpoint | What changed |
|---|---|---|
| 2026-10-13 | **CP0** `b07b321` | `UserRole` gains `AGRO_DEALER` (§5, §15); new **`OrderStatusHistory`** model — every order create/status change writes a history row (stale: §10 relationship note, §14 "No status history"); `GET /api/orders/:id` detail endpoint; **admin fixed**: platform-wide order lists (closes gap #7); env-gated admin seed (`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`, never hard-coded); shared role types `api/src/common/types.ts`; `/admin` console shell; `jest.config.ts` resolves generated-Prisma imports, enabling service unit tests |
| 2026-10-13 | **CP1** `2d8c4bc` | **Supplier listing screens**: `GET /api/supplier/products` + `/supplier/products` (list, activate/deactivate), `/supplier/products/new`, `/supplier/products/[id]`; public `GET /api/products/:id` hides DRAFT/INACTIVE (closes gap #14); broken supplier Cancel button removed (closes gap #8); `Agricultural Tools & Equipment` + `Seeds & Chemicals` categories seeded; smoke S9/S10 (create → public → deactivate → hidden) |
| 2026-10-13 | **CP2** *(deploy pending)* | **Consumer flow**: `PATCH`/`DELETE /api/addresses/:id` (default promotion, order-used → 400); buyer **Cancel** UI on PENDING orders (homepage + detail page, releases reservation); `/orders/[id]` detail page with **status timeline** from `OrderStatusHistory`; `/addresses` management page (list/create/edit/delete/make-default) + header link; smoke C1–C3 (address lifecycle, cancel releases stock, cancelled-order timeline) |

---

## 1. Repository map

Single git repo (`origin = https://github.com/spwncwr/bonagri.git`), **not** an npm-workspaces monorepo — there is no root `package.json`. Two independent npm packages plus loose scripts:

| Path | Role |
|---|---|
| `api/` | Backend — NestJS 12 REST API (`src/`, `prisma/`, `test/`, `dist/` build output, committed generated client in `src/generated/prisma/`) |
| `web/` | Frontend — Next.js 16 App Router app (`app/`, `components/`, `lib/`, `public/`) |
| `scripts/` | Bash smoke/audit scripts (`runtime-smoke.sh` 864 lines + 4 smaller check scripts). **Untracked and not gitignored** |
| `.e2e/`, `.runtime-test/` | Test artifacts (captured verification URL, JSON responses, server logs). **Untracked and not gitignored** |
| No shared packages, no infra/ dir, no CI config, no `.github/` | |

90 tracked files. No Docker files, no workspaces, no turbo/nx. `web/AGENTS.md` contains an auto-generated Next.js warning block (re-added by `next dev`); `web/CLAUDE.md` just points to it.

## 2. Tech stack (exact installed versions from lockfiles)

**Backend (`api/package-lock.json`)**
- Node: **v26.7.0** on this machine (no `engines` field anywhere)
- NestJS **12.1.0** (`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`), `@nestjs/jwt` **12.0.2**
- Prisma **7.10.0** (CLI + `@prisma/client` + `@prisma/adapter-pg`), driver-adapter mode (`PrismaPg` over `pg` **8.23.0**); generated client committed to `api/src/generated/prisma/` (generator `prisma-client`, output inside `src`)
- PostgreSQL **16.15** (Homebrew, local) — verified via `psql bonagri -c 'show server_version'`
- Validation: `class-validator` **0.15.1**, `class-transformer` **0.5.1**; Passwords: `bcryptjs` **3.0.3**; Mail: `nodemailer` **10.0.13**
- TypeScript **6.0.3**, Jest **30.5.2** + ts-jest **2.9.4.14**, supertest **7.x**, oxlint **1.85.0**, prettier **3.9.9**
- `@nestjs/observe` **0.3.0** is declared but **never imported** (dead dependency)

**Frontend (`web/package-lock.json`)**
- Next.js **16.3.6** (App Router), React **19.2.8**, TypeScript **5.9.3**
- Styling: Tailwind CSS **4.3.3** via `@tailwindcss/postcss` (PostCSS config); no UI component library (raw utility classes)
- State management: none — local React `useState`/`useEffect` per page; no data-fetching library
- ESLint **9.39.5** + `eslint-config-next` **16.3.6**
- PWA (partial): `app/manifest.ts`, `public/sw.js`, `components/service-worker-register.tsx` — **the register component is never imported/mounted anywhere**, so the SW is never registered. `layout.tsx` metadata still says "Create Next App".

## 3. How to run — exact commands and current status

| Step | Command | Status (verified 2026-10-12) |
|---|---|---|
| Install API deps | `cd api && npm install` | ✅ `node_modules` present, `npm ls --depth=0` clean, versions match lockfile (fresh install **UNVERIFIED** this session) |
| Install web deps | `cd web && npm install` | ✅ same |
| API env | copy values into `api/.env` (no `.env.example` exists) | ✅ all 9 vars set locally |
| Web env | `web/.env.local` → `NEXT_PUBLIC_API_BASE_URL` | ✅ set |
| Migrations | `cd api && npx prisma migrate deploy` (dev: `migrate dev`) | ✅ `prisma migrate status` → "Database schema is up to date!" (2 migrations) |
| Validate schema | `npx prisma validate` | ✅ valid |
| Seed | `npx prisma db seed` (→ `tsx prisma/seed.ts` via `prisma7.config.ts`) | Configured; idempotent upserts; not re-run this session (**UNVERIFIED** today) |
| API dev server | `cd api && npm run start:dev` (port `PORT` or 3000, global prefix `/api`) | Not started this session; health endpoint code verified (**UNVERIFIED** runtime) |
| Web dev server | `cd web && npm run dev -- --port 3001` | Expected by CORS + `WEB_BASE_URL` defaults (**UNVERIFIED** runtime) |
| API build | `cd api && npm run build` | ✅ exit 0 |
| Web build | `cd web && npm run build` | ✅ exit 0; routes: `/`, `/login`, `/supplier`, `/supplier/inventory`, `/verify-email`, `/manifest.webmanifest` |
| API unit tests | `cd api && npm test` | ✅ exit 0 — but only **1 trivial test** (`app.controller.spec.ts`, testing dead code) |
| API e2e tests | `cd api && npm run test:e2e` | ❌ **FAILS** — Jest cannot resolve the generated Prisma client's `.js` relative imports (`Cannot find module './internal/class.js' from '../src/generated/prisma/client.ts'`) |
| Web tests | none | ❌ no `test` script exists |
| API lint | `cd api && npm run lint` | ✅ exit 0, 1 warning (`mail.service.ts:45` unbound-method) |
| Web lint | `cd web && npm run lint` | ✅ exit 0 |
| Full runtime smoke | `bash scripts/runtime-smoke.sh` | ✅ **re-run 2026-10-13**: all 13 sections green (auth→verify→login→address→order→lifecycle, S8 history, S9/S10 listings, C1–C3 consumer flow); mutates the local dev DB |

## 4. Environment variables (names only)

**`api/.env`** (gitignored; all set locally):
- `DATABASE_URL` — Postgres connection string. Used in `src/prisma/prisma.service.ts`, `prisma/seed.ts`, `prisma7.config.ts`
- `JWT_SECRET` — JWT signing secret. Used in `src/auth/auth.module.ts`. **No fail-fast check if missing**
- `JWT_EXPIRES_IN` — present in `.env` but **never read by any code** (lifetime hard-coded, see §7)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` — nodemailer config in `src/mail/mail.service.ts`; if unset, transporter is null and sending throws 503
- `WEB_BASE_URL` — base URL for verification links in `src/auth/auth.service.ts` (default `http://localhost:3001`)

**Code-read env vars not in `.env`:** `PORT` (`main.ts`, default 3000), `NODE_ENV` + `E2E_CAPTURE_MAIL` + `E2E_MAIL_CAPTURE_FILE` (`mail.service.ts` test hook: writes verification URL to a file outside production), `SUPPLIER_SEED_PASSWORD` (`prisma/seed.ts`, default `BonAgriDev123!`).

**`web/.env.local`:** `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:3000`) — duplicated as a const in `lib/auth.ts`, `app/page.tsx`, `app/login/page.tsx`, `app/verify-email/page.tsx`, `app/supplier/page.tsx`, `app/supplier/inventory/page.tsx`.

**Scripts-only:** `API_URL`, `WEB_URL`, `API_PREFIX`, `E2E_PSQL_TARGET`, `SUPPLIER_E2E_EMAIL`, `SUPPLIER_E2E_PASSWORD` (`scripts/runtime-smoke.sh`).

## 5. Database (Prisma schema — `api/prisma/schema.prisma`)

7 enums, 13 models. All verified against the schema and migrations.

**Enums:** `UserRole` (BUYER/SUPPLIER/ADMIN), `UserStatus` (ACTIVE/SUSPENDED/PENDING), `ProductStatus` (DRAFT/ACTIVE/INACTIVE), `OrderStatus` (PENDING/CONFIRMED/PROCESSING/READY_FOR_DELIVERY/OUT_FOR_DELIVERY/DELIVERED/CANCELLED), `PaymentStatus` (PENDING/PROCESSING/PAID/FAILED/REFUNDED), `PaymentProvider` (OZOW/PAYFAST/MANUAL), `DeliveryStatus` (PENDING/ASSIGNED/PICKED_UP/IN_TRANSIT/DELIVERED/FAILED).

**Models** (fields condensed; all have `id String @id @default(uuid())` and timestamps where shown):

| Model | Key fields | Relations | Indexes |
|---|---|---|---|
| `User` | email `@unique`, passwordHash, firstName, lastName, phone?, `emailVerifiedAt?`, role, status | 1:1 `SupplierProfile`; 1:N `Address`, `Order`, `Notification`, `EmailVerificationToken` | role, status |
| `EmailVerificationToken` | userId, tokenHash `@unique`, expiresAt, usedAt? | N:1 `User` (cascade) | userId, expiresAt |
| `SupplierProfile` | userId `@unique`, businessName, description?, registrationNo?, phone?, email?, address?, city?, province?, `verified Boolean @default(false)` | N:1 `User`; 1:N `Product` | businessName, province, verified |
| `Address` | userId, label, recipientName, phone?, addressLine1, addressLine2?, city, province?, postalCode?, country `@default("South Africa")`, isDefault | N:1 `User`; 1:N `Order` | userId |
| `Category` | name `@unique`, slug `@unique`, description? | 1:N `Product` | (unique constraints) |
| `Product` | supplierId, categoryId, name, slug `@unique`, sku `@unique`, description?, `price Decimal(12,2)`, unit, imageUrl?, status | N:1 `SupplierProfile` (restrict), N:1 `Category` (restrict); 1:1 `Inventory`; 1:N `OrderItem` | supplierId, categoryId, status, name |
| `Inventory` | productId `@unique`, quantity `@default(0)`, reservedQuantity `@default(0)`, `lowStockLevel @default(10)` | 1:1 `Product` (cascade) | (unique productId) |
| `Order` | orderNumber `@unique`, userId, deliveryAddressId, status `@default(PENDING)`, subtotal/`deliveryFee @default(0)`/total `Decimal(12,2)`, notes? | N:1 `User` (restrict), N:1 `Address` (restrict); 1:N `OrderItem`; 1:1 `Payment`, `Delivery`, `Invoice` | userId, status, createdAt |
| `OrderItem` | orderId, productId, productName, unitPrice, quantity, lineTotal (price/name **denormalized snapshot**) | N:1 `Order` (cascade), N:1 `Product` (restrict) | orderId, productId |
| `Payment` | orderId `@unique`, provider, status, amount, transactionRef?, paidAt? | 1:1 `Order` (cascade) | status, transactionRef |
| `Delivery` | orderId `@unique`, status, trackingNumber? `@unique`, driverName?, driverPhone?, estimatedDate?, pickedUpAt?, deliveredAt?, notes? | 1:1 `Order` (cascade) | status |
| `Notification` | userId, title, message, read | N:1 `User` (cascade) | [userId, read], createdAt |
| `Invoice` | orderId `@unique`, invoiceNumber `@unique`, subtotal, deliveryFee, total, issuedAt | 1:1 `Order` (cascade) | issuedAt |

**Relationship summary:** `User` (role BUYER/SUPPLIER/ADMIN) optionally owns one `SupplierProfile`; buyers own many `Address`es and `Order`s. `SupplierProfile` owns many `Product`s, each in one `Category` and with at most one `Inventory` row (quantity + reservedQuantity; available = quantity − reservedQuantity). An `Order` belongs to one buyer and one delivery `Address`, contains ≥1 `OrderItem` (one item per product; created one at a time), and may have one `Payment`, one `Delivery`, one `Invoice`. **There is no OrderStatusHistory / audit-log model.** `Payment`, `Notification`, and `Invoice` are never touched by any application code (`Delivery` is upserted during order status changes, `orders.service.ts:378-416`).

## 6. Backend modules (all routes are under global prefix `/api`)

Global: `ValidationPipe({ whitelist: true, transform: true })` and CORS `origin: "http://localhost:3001"` in `src/main.ts`. `AppController`/`AppService` (`GET /`) exist in `src/` but are **not registered** in `AppModule` — dead code.

**AuthModule** (`src/auth/`) — imports Prisma, Mail, `JwtModule.register({ secret: JWT_SECRET, signOptions: { expiresIn: 86400 } })`
| Route | Guards | Role | Handler |
|---|---|---|---|
| `POST /api/auth/register` | none | public | `auth.controller.ts:33` → `AuthService.register` |
| `POST /api/auth/login` | none | public | `auth.controller.ts:38` |
| `GET /api/auth/verify-email?token=` | none | public | `auth.controller.ts:43` |
| `POST /api/auth/resend-verification` | none | public | `auth.controller.ts:48` |
| `GET /api/auth/me` | JwtAuthGuard | any authenticated (ACTIVE + verified) | `auth.controller.ts:53` |

DTOs: `RegisterDto` (email, password ≥8, firstName, lastName, phone?), `LoginDto`, `ResendVerificationDto`. Services: `AuthService`; guards: `JwtAuthGuard`, `RolesGuard`; decorator: `@Roles(...)` (`auth/decorators/roles.decorator.ts`).

**HealthModule** (`src/health/`) — `GET /api/health`, public, runs `SELECT 1` and returns status/DB/timestamp/responseTimeMs.

**CatalogModule** (`src/catalog/`) — imports AuthModule
| Route | Guards | Role |
|---|---|---|
| `GET /api/categories` | none | public |
| `GET /api/products?search=&category=` | none | public (only `status: ACTIVE`, includes category+supplier+inventory) |
| `GET /api/products/:id` | none | public (any status — see §13) |
| `GET /api/supplier/inventory` | JwtAuthGuard + RolesGuard | SUPPLIER, ADMIN |
| `PATCH /api/supplier/inventory/:productId` | JwtAuthGuard + RolesGuard | SUPPLIER, ADMIN (ownership-checked; qty cannot drop below reserved) |
| `POST /api/products` | JwtAuthGuard + RolesGuard | SUPPLIER (creates product + inventory; default status DRAFT) |
| `PATCH /api/products/:id` | JwtAuthGuard + RolesGuard | SUPPLIER (ownership-checked; can change price/status/etc.) |

DTOs: `CreateProductDto`, `UpdateProductDto`, `UpdateInventoryDto`.

**OrdersModule** (`src/orders/`) — class-level `@UseGuards(JwtAuthGuard)`
| Route | Role | Notes |
|---|---|---|
| `GET /api/orders` | BUYER, ADMIN | buyer order list; service then rejects non-BUYER with 400 (`orders.service.ts:35`) — ADMIN allowance is inconsistent |
| `GET /api/orders/supplier` | SUPPLIER, ADMIN | orders containing the supplier's items; ADMIN would 404 (no supplier profile) |
| `POST /api/orders` | BUYER | create single-product order (see §8) |
| `PATCH /api/orders/:id/status` | any authenticated | authorization done inside the service (see §8) |

DTOs: `CreateOrderDto` (deliveryAddressId, productId, quantity ≥1, notes?) — **single product per order**; `UpdateOrderStatusDto` (status ∈ 6 non-PENDING values).

**AddressesModule** (`src/addresses/`) — class-level `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles("BUYER")`
| Route | Role |
|---|---|
| `GET /api/addresses` | BUYER |
| `POST /api/addresses` | BUYER (first address or `isDefault` unsets previous default) |

**MailModule** (`src/mail/`) — provider `MailService`, no controller.

## 7. Authentication and authorization

- **Registration** (`auth.service.ts:22`): email lowercased/trimmed; 409 if exists; bcrypt cost **12**; **role hard-coded to BUYER** — there is no API to create SUPPLIER/ADMIN accounts (only `prisma/seed.ts` creates a supplier; no admin exists anywhere). Generates 32-byte random token, stores **SHA-256 hash** with 24 h expiry, sends email; if sending fails, the user row is deleted and the error rethrown (compensating rollback). Response: `{ message, emailVerificationRequired: true, user }`.
- **Email sending today**: nodemailer SMTP transport (`mail.service.ts`), plain-text + HTML mail from `SMTP_FROM`. With SMTP vars unset, sending throws 503. Test hook `E2E_CAPTURE_MAIL=true` writes the raw verification URL to `.e2e/verification-url.txt` instead of/in addition to sending (non-production only).
- **Verification** (`GET /api/auth/verify-email`): token looked up by hash; invalid/expired/used → 401; already-verified → success response; otherwise transactionally sets `User.emailVerifiedAt` and marks token `usedAt` (single-use; reuse → 401, verified in code and by the smoke script). `POST /resend-verification` invalidates outstanding tokens and issues a new one (404-style 401 if user missing — prevents enumeration partially, but message differs for unverified-vs-inactive).
- **JWT**: payload `{ sub: userId, email, role }`, HS256 via `@nestjs/jwt`, **lifetime hard-coded 86400 s (24 h)** in `auth.module.ts:19` — `JWT_EXPIRES_IN` env var is ignored. No refresh tokens, no revocation/logout.
- **JwtAuthGuard** (`guards/jwt-auth.guard.ts`): requires `Authorization: Bearer`; verifies token; then **re-loads the user from DB** (`AuthService.validateUser`) requiring `status === ACTIVE` and `emailVerifiedAt` set — so suspended/unverified users are locked out even with a valid token.
- **RolesGuard** (`guards/roles.guard.ts`): reads `@Roles(...)` metadata; no metadata → allow; else `request.user.role` must be included or 403. **Fragile:** it assumes `JwtAuthGuard` ran first on the same route (currently always paired; without it, `request.user` is undefined → 500).
- **Isolation**: route-level roles (buyer endpoints vs supplier endpoints) + service-level ownership checks: addresses/orders filtered by `userId`; supplier product/inventory queries require `supplier.userId === actor`; supplier status changes require owning ≥1 order item; buyer status change requires owning the order. Buyers cancelling a foreign order get 404 (no existence leak).
- **Not present**: password reset, refresh tokens, rate limiting, helmet/CORS hardening, account lockout, admin login/UI.

## 8. Order flow

**Creation** (`orders.service.ts:118`, `POST /api/orders`, BUYER only) — inside `prisma.$transaction`:
1. Buyer must exist, role BUYER, status ACTIVE.
2. Delivery address must exist **and belong to the buyer**.
3. Product must exist and be `status: ACTIVE`; must have an `Inventory` row.
4. Availability check: `quantity > (inventory.quantity − inventory.reservedQuantity)` → 400 "Only N … available".
5. `subtotal = Number(product.price) * quantity`; `deliveryFee = 0` (hard-coded); total = subtotal.
6. Creates `Order` (status **PENDING**, order number `BON-YYYYMMDD-<6 random digits>`) with one `OrderItem` snapshot (name, unitPrice, lineTotal).
7. **Reservation**: `Inventory.reservedQuantity += quantity` (same transaction).

**Status lifecycle** (`PATCH /api/orders/:id/status`, transition map at `orders.service.ts:300-314`):
`PENDING → CONFIRMED → PROCESSING → READY_FOR_DELIVERY → OUT_FOR_DELIVERY → DELIVERED`; `PENDING → CANCELLED`; DELIVERED/CANCELLED terminal.

**Who may trigger** (`orders.service.ts:263-298`):
- **BUYER**: only `CANCELLED` and only from `PENDING`, and only own order (else 404). Cancellation **releases the reservation** (`reservedQuantity -= qty`, guarded `updateMany` requiring `reservedQuantity >= qty`, else 400).
- **SUPPLIER**: may not cancel (400). If the supplier owns at least one item in the order, they may trigger **any** transition on the map — i.e. a supplier walks the order all the way PENDING→…→DELIVERED. There is no per-stage role split (no separate delivery role).
- **ADMIN**: passes all ownership checks (can do anything the map allows, including cancelling a PENDING order).
- Inventory **decrement happens at CONFIRMED**: `quantity -= qty` and `reservedQuantity -= qty` (stock becomes sold). No side effects at later stages except the `Delivery` upsert: READY_FOR_DELIVERY → `Delivery.status = PENDING`; OUT_FOR_DELIVERY → `IN_TRANSIT` + `pickedUpAt`; DELIVERED → `DELIVERED` + `deliveredAt`.
- **Buyer sees final status** via `GET /api/orders` (list includes status) and the PATCH response — exercised by `scripts/runtime-smoke.sh` steps S7 and 11b.
- **No status history/audit trail is recorded**; `Payment`, `Invoice`, `Notification` are never created.

## 9. Frontend

- **Routing** (Next.js App Router, all client components): `/` (marketplace + product modal + address management + "My Orders" — one 1,555-line file `app/page.tsx`), `/login` (`app/login/page.tsx`), `/verify-email` (`app/verify-email/page.tsx`), `/supplier` (order queue, `app/supplier/page.tsx`), `/supplier/inventory` (`app/supplier/inventory/page.tsx`). No register page, no admin pages, no dedicated product/order detail pages, no cart/checkout routes. Tracked backups `page.before-marketplace-redesign.tsx` and `page.tsx.before-ordering` sit in `app/`.
- **API client layer**: none — each page declares its own `API_BASE_URL` const and calls raw `fetch`. `lib/auth.ts` is the only shared lib: token storage (`localStorage` or `sessionStorage` by "Remember me"), `authHeaders()`, `clearAuth()`, `fetchCurrentUser()` (calls `/api/auth/me`, clears token on failure).
- **Auth/session handling**: `components/auth/auth-guard.tsx` client guard — fetches current user, redirects to `/login`, exact-role check (`requiredRole`), spinner while checking. It does **not** pass the user to children (pages refetch it themselves). The homepage is unguarded (public browsing) and prompts login at order time.
- **Shared components**: only `AuthGuard`, `SummaryCard` (defined twice, duplicated in both supplier pages), `Metric`, `ServiceWorkerRegister` (unmounted). No component library.
- **Forms/validation**: controlled inputs + HTML `required` + manual imperative checks (e.g. integer/quantity-vs-reserved checks in `inventory/page.tsx:230-250`); no react-hook-form/zod.
- **Error/loading patterns**: per-page `useState` (`loading`, `error`, `success`), inline red/emerald banners, disabled buttons with "…ing…" labels, `cancelled` flags in effects to avoid setState-after-unmount. API error handling: join `data.message` arrays or fallback strings. Currency rendered as `R`, dates `en-ZA`.

## 10. Existing tests

- `api/src/app.controller.spec.ts` — 1 trivial unit test ("Hello World!") for `AppController`, which is **not registered in AppModule** (dead code). Passes (`npm test` exit 0).
- `api/test/app.e2e-spec.ts` — Nest starter e2e spec. **Broken**: `npm run test:e2e` exits 1 (`Cannot find module './internal/class.js'` — Jest/ts-jest cannot resolve the generated Prisma client's `.js` imports). Even if fixed, it asserts `GET /` → "Hello World!" which no longer exists.
- **Feature unit tests exist since CP0/CP1/CP2** (2026-10-13): `orders.service.spec.ts` (12), `catalog.service.spec.ts` (8), `addresses.service.spec.ts` (12) — **32 passing** via `npm test`. Auth/catalog e2e remains broken (§10).
- `web/` — **no tests at all** (no test script, no test files).
- `scripts/runtime-smoke.sh` (untracked) — the de-facto test suite: DB reachability, boots API (port 3000) + web (port 3001), public catalog, buyer registration, unverified-login block (expects 401), captures verification URL, verifies email, verifies token reuse → 401, verified login (expects 201), `/auth/me`, authenticated catalog, address create/retrieve, buyer order create (expects 201), **inventory reservation delta verified directly via psql**, supplier login, supplier order visibility (expects PENDING), buyer → `/orders/supplier` must 403, supplier walks PENDING→CONFIRMED→PROCESSING→READY_FOR_DELIVERY→OUT_FOR_DELIVERY→DELIVERED, buyer finally sees DELIVERED ("S1–S7 acceptance"); extended by CP0 (**S8** order-detail history), CP1 (**S9–S10** listing create/deactivate lifecycle), CP2 (**C1–C3** address CRUD + defaults + FK guard, buyer cancel releases reservation, cancelled-order timeline). ✅ Full run green 2026-10-13.
- Smaller untracked scripts (`harden-and-verify.sh`, `integration-audit.sh`, `final-integrity-check.sh`, `fix-registration-verification.sh`) are grep-based self-checks, not tests.
- **Coverage gaps**: all service logic unit tests; web UI tests; fixed e2e suite; negative-path tests (oversell concurrency, cross-supplier access, admin flows).

## 11. Coding conventions (for matching by new contributors)

- **API layout**: one folder per feature (`controller.ts`, `service.ts`, `module.ts`, `dto/`); modules import `AuthModule` for guards; `PrismaModule` is `@Global()`.
- **Naming**: kebab-case files, PascalCase classes, camelCase methods; DTO classes use `!` definite-assignment and class-validator decorators; roles/statuses are **string-literal unions** in TS (duplicated per file, not imported from the generated Prisma enums).
- **DTO style**: class-validator only (`@IsEmail`, `@IsString`, `@IsUUID`, `@IsIn`, `@Min`, `@MaxLength`…), `@IsOptional()` for optionals; global `ValidationPipe` with `whitelist + transform` (`@Type(() => Number)` for numeric coercion).
- **Error handling**: Nest HTTP exceptions (`BadRequest/NotFound/Conflict/Unauthorized/ServiceUnavailable`) with human-readable message strings; no error codes/envelope. Responses are plain Prisma entities or hand-built objects — **no response wrapper** (Decimals serialize as strings).
- **Quotes**: `.prettierrc` declares `singleQuote: true`, but **all recently written API code uses double quotes** and `npm run format` would rewrite it — the de-facto current style is double quotes; flag this before formatting anything.
- **Lint**: oxlint type-aware (`no-floating-promises: error`, `no-explicit-any: off`); web uses eslint-config-next.
- **Frontend**: "use client" pages, inline Tailwind utility classes, local state hooks, duplicated per-page API const, `en-ZA`/`R` formatting, emerald/slate palette.
- **Commits**: Conventional Commits, lowercase, imperative — `feat: …`, `chore: …` (10 feat / 3 chore so far).
- **Generated Prisma client is committed** under `api/src/generated/prisma/` — schema changes require regenerating and committing it.

## 12. Gap analysis

### Reported-DONE checklist

| Item | Verdict | Evidence |
|---|---|---|
| NestJS API foundation | **VERIFIED DONE** | `api/src/main.ts`, `app.module.ts`, build ✅ |
| PostgreSQL connection | **VERIFIED DONE** | `prisma.service.ts` (PrismaPg + DATABASE_URL), `migrate status` ✅, health check runs `SELECT 1` |
| Prisma ORM + schema + migrations | **VERIFIED DONE** | `prisma/schema.prisma`, 2 migrations, `prisma validate` ✅ |
| Routing structure | **VERIFIED DONE** | 5 feature modules, `/api` prefix |
| Global validation | **VERIFIED DONE** | `main.ts:14-19` ValidationPipe whitelist+transform |
| API build passing | **VERIFIED DONE** | ran `npm run build`, exit 0 |
| Registration | **VERIFIED DONE** | `auth.controller.ts:33`, `auth.service.ts:22` (BUYER-only) |
| JWT | **VERIFIED DONE** | `auth.module.ts`, `jwt-auth.guard.ts` |
| Buyer/supplier roles | **VERIFIED DONE** | `UserRole` enum, `@Roles` + `RolesGuard` |
| Admin role foundation | **VERIFIED DONE** (CP0 `b07b321`) | env-gated admin seed (`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`), `GET /api/orders` returns platform-wide lists for ADMIN, `/admin` console shell; admin verified live on 2026-10-13 |
| `/auth/me` | **VERIFIED DONE** | `auth.controller.ts:53` |
| Email verification | **VERIFIED DONE** (⚠ uncommitted) | `auth.service.ts`, `EmailVerificationToken` model, migration `20261002232548_add_email_verification`, `web/app/verify-email/page.tsx` |
| Unverified-account login block | **VERIFIED DONE** | `auth.service.ts:272-276` (401) |
| Verified login | **VERIFIED DONE** | `auth.service.ts:246-279` |
| Categories API | **VERIFIED DONE** | `catalog.controller.ts:37` |
| Active products API | **VERIFIED DONE** | `catalog.controller.ts:42` (+ search/category filters) |
| Product schema | **VERIFIED DONE** | `schema.prisma:153-176` |
| Supplier inventory foundation | **VERIFIED DONE** | `catalog.controller.ts:50,57`, service ownership checks |
| Delivery-address backend create/retrieve/update/delete | **VERIFIED DONE** (CP2) | `addresses.controller.ts`: GET, POST, `PATCH :id` (partial update + default promotion), `DELETE :id` (order-used → 400; deleting the default promotes the newest remaining address) |
| Buyer order creation endpoint | **VERIFIED DONE** | `orders.controller.ts:50`, `orders.service.ts:118` (single-product orders only) |
| Inventory reservation | **VERIFIED DONE** | `orders.service.ts:212-219` (+ psql check in smoke script) |
| Supplier order visibility | **VERIFIED DONE** | `orders.service.ts:62-116` |
| Authorization | **VERIFIED DONE** | guards + ownership checks (§7) |
| Queue foundation | **VERIFIED DONE** | `web/app/supplier/page.tsx` (filters, next-status buttons) |
| Status updates + full lifecycle | **VERIFIED DONE** | transition map `orders.service.ts:300-314`; lifecycle exercised by smoke script S1–S7 (script not re-run today) |
| Buyer sees final status | **VERIFIED DONE** | `GET /api/orders` + smoke step S7 |
| Database/API/frontend smoke tests; buyer registration…S1 acceptance (as automated checks) | **PARTIAL** | all exist **only inside the untracked bash script** `scripts/runtime-smoke.sh`; Jest e2e is broken (§10); nothing runs in CI (there is no CI) |

### Reported-NOT-DONE checklist (confirmed)

| Item | Verdict | Evidence |
|---|---|---|
| Buyer product listing/search/filters/detail/availability/quantity | **PARTIAL** | exists in `web/app/page.tsx` (cards, search box, category filter, detail modal, availability, quantity stepper capped at stock). **Missing**: real images (`imageUrl` never rendered; hardcoded placeholder visuals `page.tsx:79-84`), standalone detail page, sorting/pagination |
| Order history/details/tracking | **VERIFIED DONE** (CP2) | "My Orders" list + **`/orders/[id]` detail page** (`web/app/orders/[id]/page.tsx`) with items, totals, delivery address, and a **status timeline** built from `OrderStatusHistory` (CP0). Delivery tracking = timeline only (no driver/GPS module — out of scope) |
| Order cancellation (buyer UI) | **VERIFIED DONE** (CP2) | Cancel button on PENDING orders in My Orders + on `/orders/[id]`; confirms, `PATCH /api/orders/:id/status {CANCELLED}`, releases the reservation (smoke C2). Broken supplier Cancel button removed in CP1 |
| Reorder | **NOT FOUND** | no code |
| Cart (add/remove/qty/total/persistence/inventory validation) | **NOT FOUND** | no cart code anywhere (`grep cart` → nothing); ordering is direct single-product from the modal |
| Checkout page / order summary / delivery fee / confirmation | **PARTIAL** | modal-based checkout with address select, summary and confirmation card (`page.tsx`); no dedicated pages; delivery fee always 0 (hard-coded, `orders.service.ts:183`) |
| Address management UI | **VERIFIED DONE** (CP2) | dedicated **`/addresses`** page (list/create/edit/delete/make-default, order-used delete surfaces the 400) + header link; modal create/select remains on the homepage checkout |
| Supplier product add/edit/activate/price UI | **VERIFIED DONE** (CP1 `2d8c4bc`) | `/supplier/products` (list + activate/deactivate), `/supplier/products/new` (draft or publish), `/supplier/products/[id]` (edit incl. status/price) calling `POST`/`PATCH /api/products` |
| Stock adjustment | **VERIFIED DONE** (UI+API) | `supplier/inventory/page.tsx`, `PATCH /supplier/inventory/:productId` |
| Stock adjustment **history** | **NOT FOUND** | no model/service |
| Low-stock alerts | **PARTIAL** | computed flag + UI badge/filter (`catalog.service.ts:151`, inventory page); no notifications |
| Supplier profile UI / supplier registration | **NOT FOUND** | no endpoint or page; supplier only via seed |
| Supplier verification workflow | **NOT FOUND** | `verified` flag exists (seeded true); no request/approve flow |
| Supplier order-detail UI | **PARTIAL** | rich order cards with items/buyer/address (`supplier/page.tsx:374-528`); no dedicated detail page |
| Admin dashboard/statistics/user-management/suspension/audit logs/permissions | **NOT FOUND** | no admin endpoints (beyond role allowances), no admin UI, no audit model. `UserStatus.SUSPENDED` exists and is enforced at login/guard, but nothing can set it |
| Payments | **NOT FOUND** (schema only) | `Payment` model + OZOW/PAYFAST enums; zero code |
| Delivery module | **PARTIAL** | `Delivery` row upserted on status change; no delivery/driver module or UI; `ASSIGNED`/`PICKED_UP`/`FAILED` never used |
| Notifications | **NOT FOUND** (schema only) | `Notification` model unused |
| Password reset | **NOT FOUND** | — |
| Refresh tokens | **NOT FOUND** | — |
| Rate limiting / security hardening | **NOT FOUND** | no throttler/helmet anywhere |
| Mobile app | **NOT FOUND** | PWA is partial: manifest + icons + `sw.js` exist but the register component is never mounted |
| CI/CD | **NOT FOUND** | no `.github/`, no CI config, no deploy scripts that run |
| Health checks | **VERIFIED DONE** | `GET /api/health` (`health.controller.ts`) — exists despite being on the NOT-DONE list |
| Production configuration | **NOT FOUND** | CORS origin hard-coded (`main.ts:11`), secrets unchecked at boot, no env-driven config module |

## 13. Risks and technical debt

1. **Huge uncommitted diff** — email verification, mail, addresses, login/verify pages, PWA and the whole `scripts/` suite exist only in the working tree. `git stash`/reset would lose the "email verification" feature that acceptance depends on. Commit first.
2. **Oversell race condition** — `createOrder` checks availability and reserves in one transaction, but under Postgres READ COMMITTED the check is a plain read (`orders.service.ts:154-180`); two concurrent orders can both pass and oversell. Needs row locking (`SELECT … FOR UPDATE` / `updateMany` with a `quantity - reservedQuantity >= n` guard).
3. **JWT_SECRET unchecked** — `auth.module.ts:17` passes `process.env.JWT_SECRET` straight through; a missing value doesn't fail fast at boot. Same for SMTP misconfiguration (fails only at send time).
4. **E2E tests are broken** (`npm run test:e2e` exit 1, §10) and the only real acceptance coverage is an **untracked 864-line bash script** wired to dev-only credentials hard-coded in the repo (`dev@bonagri.co.za` / `BonAgriDev123!` in both `seed.ts` and `runtime-smoke.sh`).
5. **No concurrency-safe or idempotent order numbers** — `BON-date-<random 6 digits>` (`orders.service.ts:14-19`); a rare collision throws a 500 from the unique constraint.
6. **Money math in floats** — `Number(product.price) * quantity` (`orders.service.ts:182`); delivery fee always 0; no currency type discipline.
7. **Admin role is illusory** — `GET /api/orders` and `/orders/supplier` allow ADMIN via the RolesGuard but the services reject them (400/404). Any admin work must reconcile this.
8. **Supplier cancel button can never succeed** (backend forbids supplier cancellation) — `web/app/supplier/page.tsx:224` vs `orders.service.ts:291-295`.
9. **No status history/audit trail** — order lifecycle mutations are silent; required for dispute resolution and the future admin audit-log feature.
10. **Single-product orders** — DTO/schema flow supports one `productId` per order; a real cart will need `OrderItem[]` input and per-supplier order splitting decisions.
11. **Dead/duplicated code** — `AppController`/`AppService` + their spec (unregistered), committed page backups (`page.before-marketplace-redesign.tsx`, `page.tsx.before-ordering`), `@nestjs/observe` unused dependency, `JWT_EXPIRES_IN` env ignored, duplicated `SummaryCard` and `API_BASE_URL` consts, `ServiceWorkerRegister` never mounted, default "Create Next App" metadata.
12. **Housekeeping** — `.runtime-test/` and `.e2e/` are **not gitignored** (logs, captured verification URLs, API responses would be committed by `git add .`); no `.env.example`; prettier config (single quotes) contradicts actual code style (double quotes).
13. **Fragile guards** — `RolesGuard` 500s if ever used without `JwtAuthGuard`; string-literal role/status unions duplicated per file instead of shared constants.
14. **Scaling gaps** — no pagination/limits on `GET /products` or order lists; `contains` search is unindexed ILIKE; `GET /products/:id` returns **DRAFT/INACTIVE products to the public** (`catalog.service.ts:56-71` — leaks unpublished supplier data).
15. **Frontend architecture** — `page.tsx` is a 1,555-line all-in-one client component; no API layer, no shared types between web and api (types re-declared per page); no error boundary; token in localStorage (XSS exposure) with no refresh strategy.
