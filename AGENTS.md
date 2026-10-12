# BonAgri — Agent Guide

## Project summary

BonAgri is an agricultural marketplace for South Africa (Limpopo-focused) with three roles: **BUYER**, **SUPPLIER**, **ADMIN**. Buyers browse active products, save delivery addresses, and place single-product orders (inventory is reserved, then consumed on CONFIRMED). Suppliers advance orders through the fulfilment lifecycle: PENDING → CONFIRMED → PROCESSING → READY_FOR_DELIVERY → OUT_FOR_DELIVERY → DELIVERED (buyers may cancel their own PENDING orders). Accounts must verify their email before they can log in.

Status: MVP backend + minimal web UI are working; cart/checkout, supplier product UI, admin area, payments, and notifications are **not built yet**. See `docs/PROJECT_AUDIT.md` for the full verified audit (routes, schema, gaps, risks).

## Repo map

Not an npm-workspaces monorepo — two independent npm packages in one git repo:

- `api/` — NestJS 12 REST API. Global prefix `/api`. Prisma 7 (driver-adapter mode, generated client **committed** at `api/src/generated/prisma/`). Feature folders: `auth/`, `catalog/`, `orders/`, `addresses/`, `mail/`, `health/`, `prisma/`.
- `web/` — Next.js 16 App Router frontend (React 19, Tailwind 4). Pages: `/` (marketplace + ordering + buyer order list), `/login`, `/verify-email`, `/supplier`, `/supplier/inventory`.
- `scripts/` — bash smoke/acceptance scripts; `runtime-smoke.sh` is the de-facto test suite (needs local Postgres + seeded DB).
- `.e2e/`, `.runtime-test/` — generated test artifacts; never commit them (add to `.gitignore` if touched).

## Commands (run from `api/` or `web/`)

```bash
# API
npm install
npx prisma migrate deploy      # apply migrations (dev: npx prisma migrate dev)
npx prisma db seed             # idempotent dev seed (supplier/buyer/products)
npm run start:dev              # dev server on :3000 (health: GET /api/health)
npm run build                  # must pass
npm test                       # unit tests
npm run test:e2e               # e2e (currently broken — see docs/PROJECT_AUDIT.md §10)
npm run lint                   # oxlint (type-aware)

# Web
npm install
npm run dev -- --port 3001     # frontend on :3001 (CORS allows only this origin)
npm run build                  # must pass
npm run lint                   # eslint

# Full end-to-end smoke (from repo root; mutates local dev DB)
bash scripts/runtime-smoke.sh
```

## Environment

- `api/.env`: `DATABASE_URL`, `JWT_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `WEB_BASE_URL` (names only — never print or commit values).
- `web/.env.local`: `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:3000`).
- There is no `.env.example` yet; if you add one, commit only placeholders.

## Conventions to follow

- **Backend layout**: one folder per feature (`*.controller.ts`, `*.service.ts`, `*.module.ts`, `dto/`). Modules that need auth import `AuthModule`; `PrismaModule` is global.
- **DTOs**: class-validator decorated classes with `!` definite assignment; rely on the global `ValidationPipe({ whitelist: true, transform: true })`. Use `@Type(() => Number)` for numeric query/body coercion.
- **AuthZ**: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles("BUYER" | "SUPPLIER" | "ADMIN")` on the controller; always re-check ownership inside the service (filter by `userId` / `supplier.userId`).
- **Errors**: Nest HTTP exceptions (`BadRequestException`, `NotFoundException`, `ConflictException`, `UnauthorizedException`) with human-readable message strings. No response envelope — return plain objects/Prisma entities (Decimals serialize as strings).
- **Money**: prices are `Decimal(12,2)` in the DB; existing code computes totals in JS numbers — keep consistency, and prefer Decimal-safe math for new money logic.
- **Frontend**: client components with local `useState`/`useEffect`; raw `fetch` against `NEXT_PUBLIC_API_BASE_URL`; token in localStorage/sessionStorage via `lib/auth.ts` (`authHeaders()`); guard supplier pages with `components/auth/auth-guard.tsx`; inline Tailwind classes, emerald/slate palette, `R` currency, `en-ZA` dates.
- **Prisma**: after editing `api/prisma/schema.prisma`, regenerate the client (`npx prisma generate`) and **commit the regenerated files** under `api/src/generated/prisma/`. Add a new migration — never edit an applied one.
- **Commits**: Conventional Commits, lowercase, imperative (`feat: add buyer reorder endpoint`).
- **Style**: API code currently uses double quotes even though `.prettierrc` says `singleQuote` — do not mass-reformat; follow the surrounding file.

## Hard rules

1. **Do not commit secrets.** Never commit `.env` values, tokens, passwords, or real SMTP credentials. Dev seed credentials in `prisma/seed.ts` and `scripts/` are for local use only — do not reuse them anywhere real.
2. **Never edit applied migrations — add new ones.** Migrations in `api/prisma/migrations/` that exist in git are immutable; create a new migration for every schema change.
3. **Every feature needs tests.** Add unit tests for service logic and extend `scripts/runtime-smoke.sh` (or add Jest e2e tests) for any new endpoint or flow. Frontend changes need at least a build + lint-verified smoke path.
4. **Run build and tests before declaring done.** Minimum gate: `api/npm run build`, `api/npm test`, `api/npm run lint`, `web/npm run build`, `web/npm run lint` — all must pass (and note any pre-existing failures you did not fix).
5. Investigation/editing aside, keep the tree clean: do not leave backup files (`*.before-*`), untracked scratch dirs, or generated artifacts outside the documented locations.
