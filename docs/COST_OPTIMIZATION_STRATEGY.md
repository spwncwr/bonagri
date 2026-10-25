# BonAgri — Cost Minimization & Centralization Strategy

**Goal:** minimize spend while making the system *healthier* (reliable, observable, backed up),
consolidate to a **single centralized system base / backend / database**, convert as much spend as
possible to a **fixed monthly payment**, all inside a **$5,000/month budget**.

Prepared: 2026-10-23 · prices as verified 2026-10-22 (Hostinger 2026-10-23) · USD ·
1 USD = 1,734 MWK · Companion docs: `COST_QUOTATION.md`, `STARTUP_MONTHLY_COSTS.docx`.

---

## 1. The one budget fact that shapes everything

At the verified fee structure (3% blended MDR), **$5,000/month ≈ the Growth scenario** — about
**5,000 orders/month at $30 AOV ($150k GMV)**:

| Growth budget line | $/month |
|---|---|
| Payment fees (3.06% on $150k GMV) | 4,590 |
| Supplier payouts + levy | 115 |
| SMS (10k msgs) | 130 |
| Fixed stack (centralized, healthy) | ~260 |
| **Total** | **~$5,095** |

- **If payment MDRs are netted from collected GMV** (typical for marketplaces — fees are deducted
  before settlement, not paid from the operating budget), then $5,000/month is *pure operating
  budget*. Everything except payments at **Scale** (fixed stack, SMS, email overage, maps, backups)
  is only ~$2,000/month — so $5k covers Scale ops comfortably with **large headroom**.
- **If payments count against the $5k**, the ceiling is ~5,000–5,500 orders/month. Getting to
  Scale (50,000 orders/mo) inside $5k would require a blended MDR of ~0.16% — impossible without
  renegotiating operator rates *and* raising the budget.

**Open question #1 (decides which branch we execute): do payment fees count against the $5,000?**
This strategy is written to satisfy both branches; everything except the payment reserve is identical.

---

## 2. Cost anatomy — what can and cannot be fixed

| Cost class | Examples | Fixed? | How we fix/cap it |
|---|---|---|---|
| **Infrastructure** | Render hosts, Postgres, backups | ✅ yes | Fixed instance tiers, one vendor, annual lines |
| **Media/email** | Cloudinary, Resend | ✅ mostly | Subscription plans (Plus annual, Pro) instead of overages |
| **Observability** | Sentry, UptimeRobot | ✅ yes | Fixed tiers (or free until they hurt) |
| **Domain/mailboxes** | Hostinger .com, Zoho | ✅ yes | Annual/low fixed |
| **SMS** | Africa's Talking | ⚠️ capped | Prepaid credit + **hard code-level send cap** (daily budget) |
| **Maps** | Google | ⚠️ capped | Stay inside 10k/SKU free caps + **hard quota on API key** |
| **Payment fees** | MDR, payouts | ❌ per-transaction | Not fixedable — reserve + policy controls (§6) |
| **Cloud overages** | images/DB growth | ⚠️ capped | Usage alerts at 80%, scale-up decisions are explicit |

**Rule: every dollar in the budget is either a fixed commitment or inside a documented cap.**

---

## 3. Centralization decision — one system base, one backend, one database

Today: **Render** (API + web) + **Neon** (DB) — two vendors, two dashboards, usage-based DB billing.
Goal: **one deployment platform, one Postgres, one invoice.**

| Option | What you get | Fixed monthly (healthy config) | Pros | Cons |
|---|---|---|---|---|
| **R — Render (recommended)** | API + web + cron/worker + **Render Postgres** + backups, one bill | **~$260** | Zero-arch change (already on Render), Prisma stays Postgres, managed backups, single invoice, no migration risk | No Africa region (US/EU latency ~same as today) |
| **D — DigitalOcean (Cape Town)** | App Platform + Managed PG + Spaces, one bill | ~$90–150 (est.) | Closest region to Malawi (~40–70ms vs ~200ms) → *healthier UX* | Re-platform effort, managed-PG extras unpriced in parts |
| **V — one VPS (Hetzner/DO droplet)** | Docker Compose: API+web+PG on one box | ~$10–70 | Cheapest | Single point of failure = **less healthy**; you run backups/patches |

**Recommendation: Option R now** (lowest risk, instant single-vendor consolidation, fixed price),
keep **Option D** as the latency upgrade path when revenue justifies the re-platform.

Satellites stay (they are not the "system base"): **Cloudflare** (free CDN/SSL/DNS — also the edge
health layer), **Cloudinary** (media, already integrated), **GitHub Actions** (CI, free).

### Migration Neon → Render Postgres (the consolidation)

1. Create Render Postgres (paid tier — Basic $19, PITR/backups per plan).
2. `pg_dump`/restore from Neon (or logical replication for near-zero downtime).
3. Point `DATABASE_URL` at Render PG on both services; **verify Prisma driver mode** (repo uses
   `@prisma/adapter-pg` → standard TCP works; if any Neon HTTP/pooler mode is in play, adjust).
4. Run gates: `npm run build`, `npm test`, `npm run lint`, `bash scripts/runtime-smoke.sh` + prod live journey.
5. Keep Neon read-only ~2 weeks as rollback, then delete (removes the second bill entirely).
6. Add **nightly `pg_dump` cron → Cloudflare R2** (offsite copy; R2 free tier covers pilot).

Effort: ~half a day + smoke. No code/schema changes expected.

---

## 4. The fixed monthly menu (Option R, healthy configuration)

| Line | Plan | $/month | Status |
|---|---|---|---|
| Render API | Standard 1c-2g (no spin-down) | 25.00 | VERIFIED |
| Render Web (SSR) | Standard 1c-2g | 25.00 | VERIFIED |
| Render cron/worker | Starter 0.5c | 7.00 | VERIFIED |
| Render Postgres | Basic 0.5c-1g + ~30 GB storage | 28.00 | VERIFIED ($19 + $0.30/GB) |
| Offsite backups | pg_dump cron → R2 | 2.00 | VERIFIED ($0.015/GB) |
| Images | Cloudinary **Plus, annual** (225 credits) | 89.00 | VERIFIED |
| Transactional email | Resend **Pro** (50k) | 20.00 | VERIFIED |
| Error tracking | Sentry **Team** | 26.00 | VERIFIED |
| Uptime | UptimeRobot Solo | 10.00 | VERIFIED |
| Mailboxes (3) | Zoho Lite annual | 5.00 | VERIFIED |
| Domain | Hostinger .com renewal | 1.67 | VERIFIED 2026-10-23 |
| CDN/SSL/DNS, CI | Cloudflare Free, GitHub Actions | 0.00 | VERIFIED |
| **Fixed total** | | **~$238** | |

Pilot variant (free tiers where health isn't hurt: Cloudinary Free, Resend Free, Sentry Free,
UptimeRobot Free, Render Starter) ≈ **$100/month fixed**.

### Capped-usage lines (variable but bounded)

| Line | Cap mechanism | Cap $/month |
|---|---|---|
| SMS | Code-level daily send budget (e.g. 400/day) + prepaid balance top-up limit | ≤ 150 |
| Maps | Free 10k/SKU caps **+ hard quota on the API key** (Google billing "budget hard cap" is alert-only) | 0 |
| Image/email overage | 80% usage alerts (Cloudinary credits, Resend volume) → explicit decision, not surprise bills | ≤ 100 buffer |
| Storage growth (incl. CP15b photos) | 80% threshold on DB disk; photos → R2 before 50 GB | ≤ 50 |
| **Capped total** | | **≤ ~$300** |

**Fixed + capped ≈ $540/month** — the entire healthy centralized system, before payment fees.

---

## 5. The $5,000 envelope (governance)

| Reserve | $/month | Rule |
|---|---|---|
| Fixed commitments (§4) | ≤ 300 | Change only in quarterly review |
| Capped usage (§4) | ≤ 300 | Hard caps in code/console; 80% alerts |
| Payment MDR reserve | ≤ 4,100 | Policy controls (§6); at 3.06% ≈ **$134k GMV/mo** |
| Contingency / unallocated | ~300 | Absorbs surprises; rolls over |

**Alerts:** 70% / 90% of the $5k on the bank/processor side; per-service usage alerts (Render budget,
Cloudinary, Resend, SMS balance, Maps quota). **Monthly review:** actuals vs envelope, re-benchmark
payment providers quarterly.

**Honest ceiling:** with today's fees, $5k total ≈ Growth (≈5,000 orders/mo). Path to Scale inside a
bigger budget = §6 fee containment, not infrastructure cuts — infra is already <6% of the envelope.

---

## 6. Payment-fee containment (the only lever that matters at scale)

1. **Net-fee structure** where possible (fees deducted at settlement → outside the $5k opex).
2. **Negotiate operator MDRs** directly (Airtel Money, TNM Mpamba — bilateral "Schedule II").
   Every 1pp saved on $150k GMV = **$1,500/month** freed.
3. **Mix steering:** incentivize wallet payments (70% target mix) vs cards (4.8%).
4. **Provider benchmark:** Flutterwave 4.8% cards / PayChangu 3% / Pesapal 3.5% — re-quote quarterly.
5. **Payout batching** to suppliers (weekly bank runs, not per-order) → fewer MK2,000 transfers + fewer
   0.05% levies.
6. **COD discipline** — no MDR, but carries returns/risk; cap at ~10% of orders.

## 7. Other cost cuts (ranked, with impact)

| Lever | Saving | Health impact |
|---|---|---|
| SMS → push (FCM/Expo, free) + email for non-urgent events | up to −$1,050/mo at Scale | neutral/better (instant delivery) |
| Maps → stay in free caps; OSM/Leaflet later | −$220/mo at Scale | neutral |
| Cloudinary → Cloudflare Images+R2 at >225 credits | −$190/mo at Scale | migration effort ~1 day |
| DB: Neon usage → Render fixed (§3) | −$17–150/mo + single invoice | better (backups in-place) |
| Annual billing (Cloudinary 10%, Zoho, Google) | −$50–100/yr | none |
| CP15b delivery photos: bytea → R2 objects | −$126/mo at Scale | **better** (smaller DB, faster restores) |
| Keep free tiers where healthy (Sentry Free, UptimeRobot Free) | −$36/mo | acceptable to ~100 orders/day |

## 8. What the fixed money buys health-wise (non-negotiables)

- Managed Postgres with **automated backups + nightly offsite copy to R2**, and a **quarterly restore drill**.
- **No single instance** for API and web (separate services; optional 2nd instance = HA toggle when revenue allows).
- Uptime monitoring (5-min) + error tracking + **alert routing** to a human.
- Staging environment on Render (free-tier instance) for migrations; CI gates already in repo (`ci.yml`, 279 unit tests, runtime smoke).
- Health endpoints already present (`GET /api/health`) — wire them to uptime checks on API *and* web.
- Log retention ≥ 14 days; quota limits on every external API key (Maps, Cloudinary, SMS).
- Documented runbook: deploy, rollback, DB restore, provider outage playbook.

## 9. Execution order

| # | Action | Effort | Cost change |
|---|---|---|---|
| 1 | Decide: do payment fees count against the $5k? (Q1) | — | sets the branch |
| 2 | Neon → Render Postgres migration + nightly offsite backup | ~0.5 day | −usage bill, +$28 fixed, one invoice |
| 3 | Lock fixed menu (§4) incl. Cloudinary Plus annual + Resend Pro | 1 h | → fixed monthly |
| 4 | Install caps: SMS daily budget, Maps hard quota, 80% alerts | ~2 h | bounds all variable lines |
| 5 | Sentry Team + UptimeRobot Solo wired to health endpoints | ~2 h | +$36 fixed, big observability gain |
| 6 | Envelope dashboard + 70/90% alerts + monthly review ritual | ~2 h | keeps $5k intact |
| 7 | Payment MDR quotes (Airtel/TNM/PayChangu/Flutterwave) | external | the only Scale-path lever |

## 10. Open questions

1. **Do payment fees count against the $5,000/month?** (netted vs opex — decides ceiling: ~5k orders/mo vs large headroom).
2. Is **latency** worth a later move to DigitalOcean Cape Town (~40–70ms vs ~200ms today)?
3. **SMS budget:** include (≤$150/mo cap) or drop MVP SMS and go push+email only (−$150)?
4. Is **redundant instance (HA)** wanted now (+~$25–50/mo) or only after revenue milestone?
5. Quarterly review owner for re-benchmarking providers?
