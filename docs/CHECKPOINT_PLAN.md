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
| CP0 | Role & audit foundations | — | pending |
| CP1 | Supplier listing screens | — | pending |
| CP2 | Consumer flow completion | — | pending |
| CP3 | Admin management | — | pending |
| CP4 | Agro dealers | — | pending |
| CP5 | Disputes | — | pending |
| CP6 | Glue & self-service | — | pending |

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

### CP3 — Admin management
Extra gates:
- Unit tests: promote-to-supplier creates vendor profile exactly once; suspend blocks
  login (401/403) and existing token gets rejected at guard; verify-toggle readable
  publicly (`GET /products` supplier.verified).
Role journey (deployed): register a fresh buyer → admin promotes them to SUPPLIER →
that user re-logs-in and lands on `/supplier` hub → admin suspends them → login refused
→ admin reactivates; admin creates/renames a category visible on marketplace.

### CP4 — Agro dealers
Extra gates:
- Unit tests: AGRO_DEALER can create/list own products + see own orders; AGRO_DEALER
  **cannot** touch another vendor's products (ownership 404s); BUYER still blocked from
  vendor routes (403).
Role journey (deployed): dealer (seeded) logs in → hub shows dealer wording → lists
"Electric Fence Energizer 12J" under Tools → buyer filters marketplace Tools segment
→ orders it → dealer walks fulfilment → buyer sees DELIVERED.

### CP5 — Disputes
Extra gates:
- Unit tests: dispute allowed only from eligible statuses and only by order buyer;
  vendor cannot open disputes; admin resolve/reject transitions; duplicate open dispute
  on same order rejected.
Role journey (deployed): buyer orders → supplier marks DELIVERED → buyer opens dispute
( DAMAGED ) → vendor sees it → admin resolves with note → buyer sees resolution →
resolution email actually arrives (SMTP already live); dispute appears in admin queue
with order history evidence.

### CP6 — Glue & self-service
Extra gates:
- Unit tests: notification rows written on configured transitions; apply→approve flow
  promotes role exactly once.
Role journey (deployed): buyer applies to sell → admin approves → user becomes dealer/
supplier on next login; notification emails observed for confirm/deliver/dispute.

## 4. Checkpoint hygiene rules

1. One phase = one PR-sized commit series ending in a green CP; no drive-by refactors.
2. Migrations are append-only; regenerate and **commit** `api/src/generated/prisma/`.
3. Extend `scripts/runtime-smoke.sh` in the phase that adds the endpoints it covers —
   the smoke script is the living acceptance suite.
4. If a checkpoint reveals a blocker, record it in `IMPLEMENTATION_PLAN.md` §5 Risks
   before continuing.
5. Production (Render/Neon) is only ever moved forward by push; verify the live
   journey at every CP — local green is not a checkpoint.
