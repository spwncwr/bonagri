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

| HP | Phase | Date | Status |
|---|---|---|---|
| HP1 | Buyer payment-method selection screen | — | pending |
| HP2 | Admin 2FA (mandatory TOTP) + sign-in alerts | — | pending |
| HP3 | Step-up confirmation + admin audit trail | — | pending |
| HP4 | Password reset / account recovery | — | pending |
| HP5 | Session hardening (refresh rotation, no storage token) | — | pending |
| HP6 | Security hygiene + admin runbook | — | pending |

Update the Status column (`pending` → `in progress` → `done (commit, date)`) as
work proceeds; a phase that stalls goes back to `pending` with a note in §3.

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
**Status**: pending
**Shipped**: —
**Deviations from plan**: —
**Gates**: —
**Live journey**: —
**Residue / follow-ups**: —

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

---

## 4. Running notes

Cross-phase observations (baseline drift, decisions confirmed mid-flight,
environment issues). Newest first.

- 2026-11-14 — Plan written; both documents committed; HP1 not yet started.
