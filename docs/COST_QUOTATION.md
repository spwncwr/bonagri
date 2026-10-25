# BonAgri — Running-Cost & Setup Cost Quotation (Malawi launch)

Prepared: 2026-10-22 · Currency: USD (MWK at the single rate in §2) · All prices VERIFIED against official
sources on 2026-10-22 unless explicitly marked **UNVERIFIED** (estimate given separately).

> **Headline caveat:** this repository was built against a South-African-shaped product (ZAR-style seed
> prices, `en-ZA` locale, Ozow/PayFast enums). This quotation prices a **Malawi** launch per instruction;
> see Open Question 6 in §9 — currency/locale/payment adaptation is real work not priced here.

---

## 1. Executive summary

### Headline figures (Recommended stack, all-in, incl. usage & payment fees, + contingency)

| Scenario | One-time (Y1) | Monthly fixed | Monthly usage (est.) | Annual | **Year-1 total** | **3-year TCO** |
|---|---|---|---|---|---|---|
| **Launch/pilot** (200 buyers, 20 suppliers, 500 orders/mo, 2k images) | $1,075 | $30 | ~$495 | $39 | **$8,526 ≈ MWK 14.8 M** | **$23,106 ≈ MWK 40.1 M** |
| **Growth** (2,000 buyers, 100 suppliers, 5,000 orders/mo, 10k images) | $0 | $243 | ~$4,835 | $183 | **$68,453 ≈ MWK 118.7 M** | **$205,360 ≈ MWK 356.1 M** |
| **Scale** (20,000 buyers, 500 suppliers, 50,000 orders/mo, 100k images) | $0 | $643 | ~$47,835 | $183 | **$640,111 ≈ MWK 1,110.0 M** | **$1,920,333 ≈ MWK 3,329.9 M** |

Year-1 totals include a contingency of 15% (pilot), 12% (growth), 10% (scale). 3-year TCO = Year-1 +
2 × same-scenario annual run-rate (no volume growth assumed between scenarios; excludes inflation).

**The dominant cost at every scale is payment transaction fees, not infrastructure.** At Growth and
Scale, mobile-money and card MDRs are ~93–99% of total spend. Infrastructure (hosting, DB, images,
email, SMS, monitoring) is only **~$30/month at pilot**, **~$240/month at Growth**, and
**~$640/month at Scale** — this platform is cheap to run; moving money in Malawi is what
costs.

### Recommended stack in one paragraph

Stay on the current architecture — **Render** (API + web, Starter at pilot → Basic/Pro at Growth/Scale),
**Neon** Postgres (Launch tier), **Cloudflare** free plan in front (free CDN + SSL + DNS), **Cloudinary**
for images (Free at pilot → Plus at Growth → Advanced at Scale), **Resend** for transactional email
(Free → Pro), **Africa's Talking** for SMS (local MWK rates, ~7–10× cheaper than Twilio), **FCM/Expo**
for push, **Sentry Developer/Team + UptimeRobot** for monitoring, **GitHub Actions** (already in use,
free) for CI. For money: onboard **Airtel Money and TNM Mpamba merchants directly** plus **Flutterwave
MW** for cards, and benchmark against **PayChangu** (3% all channels). Register/defend **bonagri.mw**
($45–60/yr, currently unregistered) and resolve **bonagri.com, which is currently parked on Afternic
and appears to be for sale** (see §9, Open Question 1). Defer Google Maps spend to zero by staying
inside the free-usage caps (10,000 events/SKU/month). The only genuinely large line items — payment
fees and SMS — are controllable by policy (encourage wallet payments, batch SMS, cap per-user OTP).

---

## 2. Assumptions and exchange rate

| # | Assumption | Value | Rationale / where to change |
|---|---|---|---|
| A1 | **Exchange rate (single cell — edit here only)** | **1 USD = 1,734 MWK** | Reserve Bank of Malawi daily rates 2026-10-21: buying 1,717.0236 / selling 1,751.0000 (midpoint 1,734.0) — rbm.mw, checked 2026-10-22. All MWK figures = USD × 1,734 |
| A2 | Average order value (AOV) | $30 (≈ MWK 52,000) | Seed prices R12–R1,250 blend (api/prisma/seed.ts); Malawi-adjusted. **This drives payment fees — the #1 cost. Change per real GMV** |
| A3 | API calls per order (browse→buy→track) | ~250 | Derived from REST flow: product list/detail paging, cart, checkout, status polling. Launch: 500×250 ≈ 125k calls/mo; Growth ≈ 1.25M; Scale ≈ 12.5M |
| A4 | SMS per order | 2 (confirmation + out-for-delivery) | MVP scope. Launch 1,000/mo; Growth 10,000/mo; Scale 100,000/mo |
| A5 | Emails per order | ~3 | Code emails **every** in-app notification (`notifications.service.ts:339`) + verification emails amortized. Launch ≈ 1,700/mo; Growth ≈ 15k/mo; Scale ≈ 150k/mo |
| A6 | Payment mix | 70% mobile money @ ~3%, 20% cards @ 4.8%, 10% cash-on-delivery @ 0% → **blended 3.06%** | MW mobile-money MDR is unpublished (UNVERIFIED benchmark); 4.8% is Flutterwave MW published card rate. **Get operator quotes — see §9 Q2** |
| A7 | Supplier payouts | 1 bank transfer/supplier/month @ MK2,000 (≈$1.15) | Flutterwave MW published bank-payout price; +0.05% mobile-money levy on transfers > MK100k (MRA, verified) |
| A8 | Images | 0.5 MB stored each; ~10 unique transforms/image/mo; CDN-cached | 2k (Launch, given) / 10k (Growth: 100 sup × 100 prod) / 100k (Scale: 500 × 200) |
| A9 | Maps (if built) | 1 geocode + 1 distance-matrix element per order; ~0.4 interactive map loads/order | Nothing is integrated today; all usage lands inside Google's free 10,000-events/SKU caps until Scale |
| A10 | DB growth | ~2 MB/order incl. 2×300 KB CP15b delivery photos (bytea) | Launch ~2 GB; Growth ~15 GB; Scale ~150 GB/yr — **photos-in-DB is a Scale risk, see §6** |
| A11 | Team mailboxes | 3 users (Launch/Growth), 10 (Scale) | Zoho/Google per-user pricing |
| A12 | CI | GitHub Actions, private repo free allowance 2,000 min/mo | Overages only at Scale (est. $6/mo) |
| A13 | Excluded | Developer salaries, marketing, office costs, app content production | Excluded per instruction |

**VAT / tax / FX note (Malawi):** VAT is **17.5%** (raised from 16.5%, effective 2025-12-30; MRA, verified).
Foreign SaaS charged to a Malawian business may attract additional charges at the card/bank: RBM's own
spread is ~2%, and bank/card all-in FX markup is estimated **2–5% (UNVERIFIED)** — budget +3% on all USD
spend if paying by Malawian card. Withholding tax on non-resident e-services: **UNVERIFIED** (commonly
cited at 15%, not confirmed with MRA — ask your accountant; it would apply to foreign SaaS fees). If
BonAgri's turnover crosses MK50m, VAT registration + MRA Electronic Invoicing integration becomes
mandatory (min. fine MK5m for operating outside EIS).

---

## 3. Repository audit findings

Evidence: file path + line or env-var name. Status: **integrated** (wired and working), **planned**
(code/docs reference it, not active), **recommended-but-missing** (required for launch, not in repo).

| # | Service | Purpose | Evidence | Status |
|---|---|---|---|---|
| 1 | **Render** (PaaS) | Hosts NestJS API + Next.js web | Live services `bonagri-api.onrender.com` / `bonagri-web.onrender.com`; no `render.yaml` (dashboard-configured) | integrated |
| 2 | **Neon serverless Postgres** | Production database | `DATABASE_URL` (api/.env, Render env); Prisma `provider = "postgresql"` (schema.prisma:datasource); `@prisma/adapter-pg` dependency | integrated |
| 3 | **SMTP via nodemailer** (provider-agnostic) | Transactional email | `SMTP_HOST/PORT/USER/PASSWORD/FROM` env; `api/src/mail/mail.service.ts:3`; flows: email verification (`auth.service.ts:78,235`), dispute resolution (`disputes.service.ts:255`), **email mirror of every in-app notification** (`notifications.service.ts:339`) | integrated |
| 4 | **Cloudinary** | Product images + supplier logos (signed direct upload) | `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` env; `api/src/media/media.service.ts` (v2 import), CP16a landed 2026-10-20 | integrated |
| 5 | **GitHub Actions** | CI (api build/lint/test + web build) | `.github/workflows/ci.yml` | integrated |
| 6 | **JWT (self-hosted)** | Authentication | `JWT_SECRET` env; `@nestjs/jwt` dependency; `auth/guards/*` | integrated (no identity SaaS needed) |
| 7 | **Ozow / PayFast / manual EFT** | Payments | `enum PaymentProvider { OZOW PAYFAST MANUAL }` (schema.prisma) — Ozow/PayFast are **South African** gateways, dead enums; only MANUAL EFT active | planned → **must be replaced for Malawi** |
| 8 | **SMS** | Order updates, OTP | **Zero references in repo** | recommended-but-missing |
| 9 | **Push notifications** (FCM/APNs/Expo) | Re-engagement | Zero references (PWA manifest exists; no service-worker push) | recommended-but-missing |
| 10 | **Maps/geocoding** (Google/Mapbox/OSM) | Address entry, delivery pins, fee calculation | Zero references; `Address` model has no lat/lng columns yet | planned (product requirement), nothing integrated |
| 11 | **Error monitoring / uptime** | Sentry, UptimeRobot, etc. | Zero references; only Render health checks | recommended-but-missing |
| 12 | **Analytics** | Product/traffic metrics | Zero references (no GA4/plausible script in web/) | recommended-but-missing |
| 13 | **Domain `bonagri.com`** | Branding | WHOIS: registered **2023-07-19**, expires 2027-07-19, registrar GoDaddy; **nameservers NS1/NS2.AFTERNIC.COM = parked on the Afternic sale marketplace** | external — likely **not owned by us**, see §9 Q1 |
| 14 | **React Native / Expo mobile app** | Android + iOS | Not in repo (plan only) | planned |
| 15 | **Object storage / backups** | DB backups, static assets | None configured (Neon free tier has minimal retention) | recommended-but-missing |
| 16 | Paid npm packages / UI kits | — | All deps MIT/Apache-2.0 (cloudinary, next, react, @nestjs/*, prisma, sharp); **$0 licence** | integrated (free) |

Services surveyed in research (§4): **≈75 providers across 20 categories**; 7 directly referenced by the repo.

---

## 4. Detailed pricing tables (all checked 2026-10-22)

### 4.1 Hosting/compute

| Provider | Plan | Price | Period | Key limits | Source | Status |
|---|---|---|---|---|---|---|
| Render | Hobby (Free) | $0 | mo | 512 MB, spins down 15 min idle, 750 hr/mo | render.com/pricing | VERIFIED |
| Render | Starter 0.5c-512mb | $7 | mo | no spin-down | render.com/pricing | VERIFIED |
| Render | Basic/Standard 1c-2g | $25 | mo | 1 vCPU/2 GB, 25 GB BW | render.com/pricing | VERIFIED |
| Render | Pro 2c-4g | ~$85 | mo | 2 vCPU/4 GB | render.com/pricing | **UNVERIFIED** (tier not rendered today) |
| Railway | Hobby | $5 (+$5 usage credit) | mo | usage-priced RAM/CPU/egress | railway.com/pricing | VERIFIED |
| Fly.io | shared-1x 256 MB (Johannesburg) | ~$2.86 | mo | in-Africa compute; Africa egress $0.12/GB | fly.io/pricing | VERIFIED |
| DigitalOcean | Droplet 512 MiB (Cape Town) | $4 | mo | 500 GiB transfer | digitalocean.com/pricing/droplets | VERIFIED |
| DigitalOcean | App Platform 1 GiB fixed | $10 | mo | containers | digitalocean.com/pricing/app-platform | VERIFIED |
| Hetzner | CX23 2vCPU/4GB | €5.99 (~$6.9) | mo | excl. VAT; no Africa DC | hetzner.com/cloud | VERIFIED |
| AWS Lightsail | 512 MB (af-south-1) | $5 | mo | 1 TB transfer | aws.amazon.com/lightsail/pricing | VERIFIED |
| AWS EC2 | t4g.micro af-south-1 | ~$7.9 | mo | closest AWS region to Malawi | — | **UNVERIFIED** est |
| Azure | B1s South Africa North | $0.0136/hr (~$9.9) | mo | closest Azure region (Johannesburg) | prices.azure.com API | VERIFIED |

### 4.2 Managed PostgreSQL

| Provider | Plan | Price | Period | Key limits | Source | Status |
|---|---|---|---|---|---|---|
| Neon | Free | $0 | mo | 1 GB project, 100 CU-hr, autosuspend | neon.tech/pricing | VERIFIED |
| Neon | Launch | $0.106/CU-hr + $0.35/GB-mo | usage | cheapest sensible prod serverless PG | neon.tech/pricing | VERIFIED |
| Neon | Scale | $0.222/CU-hr + $0.35/GB-mo | usage | more compute features | neon.tech/pricing | VERIFIED |
| Supabase | Pro | $25 | mo | 8 GB disk incl. (+$0.125/GB), daily backups 7d, PITR +$100 | supabase.com/pricing | VERIFIED |
| Render PG | Basic 0.5c-1g | $19 + $0.30/GB | mo | PITR add-ons extra | render.com/pricing | VERIFIED |
| Render PG | Free | $0 | mo | **expires 30 days after creation, no backups** | render.com/docs/free | VERIFIED |
| DO Managed PG | cheapest | from $15 | mo | +$0.215/GiB; HA from $30 | docs.digitalocean.com | VERIFIED |
| Amazon RDS | db.t4g.micro af-south-1 | ~$15.3 | mo | est.; free tier closed to new accts | — | **UNVERIFIED** est |
| Self-managed PG | on Hetzner CX23 | ~$6.9 | mo | full ops burden | hetzner.com | VERIFIED (VPS) |

### 4.3 Object storage & backups

| Provider | Plan | Price | Period | Key limits | Source | Status |
|---|---|---|---|---|---|---|
| Cloudflare R2 | Standard | $0.015/GB-mo | usage | **free egress**, 10 GB-mo free | developers.cloudflare.com/r2/pricing | VERIFIED |
| Backblaze B2 | PAYG | $6.95/TB-mo | usage | free egress ≤3× storage | backblaze.com/cloud-storage/pricing | VERIFIED |
| AWS S3 | Standard us-east-1 | $0.023/GB-mo | usage | egress $0.09/GB after 100 GB | AWS price feeds | VERIFIED |
| DO Spaces | Standard | $5/mo (250 GiB) | mo | +$0.02/GiB | docs.digitalocean.com | VERIFIED |
| Wasabi | PAYG | $7.99/TB-mo | mo | **1 TB minimum charge**, 90-day min duration | wasabi.com/pricing | VERIFIED |

### 4.4 Images (Cloudinary integrated; alternates for scale)

| Provider | Plan | Price | Period | Key limits | Source | Status |
|---|---|---|---|---|---|---|
| **Cloudinary** | Free | $0 | mo | **25 credits/mo** (1 credit = 1k transforms OR 1 GB storage OR 1 GB CDN BW) | cloudinary.com/pricing | VERIFIED |
| **Cloudinary** | Plus | $89/yr-billed ($99 monthly) | mo | 225 credits | cloudinary.com/pricing | VERIFIED |
| **Cloudinary** | Advanced | $224/yr-billed ($249 monthly) | mo | 600 credits, custom CNAME | cloudinary.com/pricing | VERIFIED |
| Cloudflare Images | Paid | $5/100k images storage; $1/100k delivery; transforms $0.50/1k after 5k free | usage | transformations-only on free plan | developers.cloudflare.com/images/pricing | VERIFIED |
| ImageKit | Free / Lite | $0 / $9 | mo | 20 GB BW free; best free BW of image CDNs | imagekit.io/plans/ | VERIFIED |
| imgix | Starter | $25 | mo | no free plan anymore | imgix.com/pricing | VERIFIED |
| Thumbor+sharp self-host | DO Droplet | $4–24 | mo | $0 licence, your ops | digitalocean.com/pricing | VERIFIED (VPS) |

### 4.5 CDN & SSL

| Provider | Plan | Price | Period | Key limits | Source | Status |
|---|---|---|---|---|---|---|
| Cloudflare | Free | $0 | mo | CDN, DDoS, Universal SSL, DNS | cloudflare.com/plans | VERIFIED |
| Cloudflare | Pro | $25/mo ($20 annual) | mo | +WAF ruleset | cloudflare.com/plans | VERIFIED |
| AWS CloudFront | JNB edge | $0.110/GB (first 10 TB) | usage | ~11× Bunny Africa | AWS price feed | VERIFIED |
| Bunny CDN | Africa | $0.06/GB | usage | $1/mo minimum | bunny.net/pricing | VERIFIED |
| Let's Encrypt | DV | $0 | — | auto-renew 90-day | letsencrypt.org | VERIFIED |

### 4.6 Domain & DNS

| Provider | Item | Price | Period | Notes | Source | Status |
|---|---|---|---|---|---|---|
| (WHOIS) | **bonagri.com status** | — | — | **Registered 2023-07-19 → 2027-07-19, GoDaddy, parked at Afternic (for sale)** | whois, 2026-10-22 | VERIFIED |
| GoDaddy | .com renewal | ~$22.99 | yr | est. (page blocks fetches); typical renewal trap | godaddy.com | **UNVERIFIED** est |
| Cloudflare Registrar | .com transfer/renew | $10.46 (from 2026-11-01) | yr | at-cost; **transfer-in only**; free privacy | developers.cloudflare.com/registrar | VERIFIED |
| Porkbun | .com | $11.08 flat | yr | register/renew/transfer | porkbun.com/products/domains | VERIFIED |
| Namecheap | .com | $11.28 promo / ~$18.48 renew | yr | promo-dependent | namecheap.com | **UNVERIFIED** est |
| **.mw registry (SDNP)** | .mw / .co.mw register & renew | **$40** | yr | 2-yr min; **bonagri.mw, bonagri.co.mw, bonagri.com.mw all unregistered as of today** | registrar.mw PDF v1.6 | VERIFIED |
| .mw retail | via accredited registrar | $45–60 (est.) | yr | markup unknown (nic.mw unreachable) | — | **UNVERIFIED** est |
| Cloudflare DNS | anycast | $0 | — | free with account | developers.cloudflare.com/dns | VERIFIED |
| Route 53 | hosted zone | $0.50 | mo | unnecessary | aws.amazon.com/route53/pricing | VERIFIED |
| Afternic (bonagri.com purchase) | aftermarket | **negotiable** | one-time | domain listed for sale; price not public | afternic.com | **UNVERIFIED** |

### 4.7 Transactional email (SMTP — any provider works with nodemailer)

| Provider | Plan | Price | Period | Key limits | Source | Status |
|---|---|---|---|---|---|---|
| Resend | Free | $0 | mo | 3,000/mo, 100/day, 1 domain | resend.com/pricing | VERIFIED |
| Resend | Pro | $20 | mo | 50k/mo; overage $0.90/1k | resend.com/pricing | VERIFIED |
| Postmark | Basic | $15 | mo | 10k/mo; overage $1.80/1k | postmarkapp.com/pricing | VERIFIED |
| SendGrid | Essentials | $19.95 | mo | 50k/mo | sendgrid.com/pricing | VERIFIED |
| Amazon SES | PAYG | $0.16/1k | usage | prod deliverability wants +$24.95/mo dedicated IP | aws.amazon.com/ses/pricing | VERIFIED |
| Mailgun | Basic | $15 | mo | 10k/mo | mailgun.com/pricing | VERIFIED |
| Brevo | Starter | $9 | mo | 5k/mo | brevo.com/pricing | VERIFIED |

### 4.8 Business mailboxes

| Provider | Plan | Price | Period | Notes | Source | Status |
|---|---|---|---|---|---|---|
| Zoho Mail | Free | $0 | — | 5 users, 5 GB, ads | zoho.com/mail | VERIFIED |
| Zoho Mail | Lite / Premium | $1 / $4 per user | mo (annual) | min 5 users | zoho.com/mail | VERIFIED |
| Google Workspace | Starter | $7/user (annual) | mo | 30 GB | workspace.google.com/pricing | VERIFIED |
| Microsoft 365 | Business Basic | $7/user (annual) | mo | 1 TB + Exchange | microsoft.com | VERIFIED |
| SPF/DKIM/DMARC | — | $0 | — | free DNS records | — | VERIFIED |

### 4.9 SMS to Malawi (the price spread is enormous — choose carefully)

| Provider | Price per SMS | Period | Notes | Source | Status |
|---|---|---|---|---|---|
| **Yoola SMS (MW-local)** | MWK 30–40 ≈ **$0.017–0.023** | per SMS | cheapest; sender ID incl.; mobile-money top-up | yoolasms.com/pricing?country=MW | VERIFIED |
| **Africa's Talking** | MWK 21/26 (Airtel/TNM) ≈ **$0.012–0.015** basic tier; down to MWK 15/20 at Max spend; **Malawi covered**; sender ID currently free | per SMS | dedicated short code: MWK 300k/625k setup + MWK 185k/375k per operator | africastalking.com/pricing | VERIFIED |
| eSMS Africa | MWK 67–78 ≈ $0.039–0.045 | per SMS | sender-ID reg $100 one-time | esmsafrica.io/sms/malawi | VERIFIED |
| Bird (MessageBird) | $0.23 | per segment | intl aggregator | bird.com/pricing/sms/mw.md | VERIFIED |
| Twilio | $0.3307 | per segment | ~25× local price | twilio.com/en-us/sms/pricing/mw | VERIFIED |
| Vonage | €0.29634 | per msg | XLSX rate sheet (2025-02-03) | dashboard.nexmo.com/download_pricing | VERIFIED |
| MACRA sender-ID fee | ~$100 (proxy) | one-time | no published MACRA schedule; alphanumeric ID suffices | d7networks.com country regs | **UNVERIFIED** est |

### 4.10 Maps & geocoding (nothing integrated; priced for when it is)

| SKU/provider | Price | Free cap | Source | Status |
|---|---|---|---|---|
| Google — **the old $200/mo credit is DEAD** (retired 2025-03-01) | replaced by per-SKU free usage | — | developers.google.com/maps/billing-and-pricing/faq | VERIFIED |
| Google Dynamic Maps (JS) | $7.00/1k loads | **10,000/mo** | developers.google.com/maps/billing-and-pricing/pricing | VERIFIED |
| Google Geocoding | $5.00/1k | 10,000/mo | same | VERIFIED |
| Google Places Autocomplete | $2.83/1k requests (use session tokens!) | 10,000/mo | same | VERIFIED |
| Google Place Details (Essentials) | $5.00/1k | 10,000/mo | same | VERIFIED |
| Google Distance Matrix / Routes | $5.00/1k elements | 10,000/mo | same | VERIFIED |
| Google Static Maps | $2.00/1k | 10,000/mo | same | VERIFIED |
| Google subscriptions | Starter $100 (50k calls, no Places); Essentials $275 (100k, full) | — | cloud.google.com/maps/platform/pricing | VERIFIED |
| Mapbox map loads | $5.00/1k after **50,000 free** | 50,000/mo | mapbox.com/pricing | VERIFIED |
| Mapbox permanent geocoding (storing results) | $5.00/1k, **no free tier** | — | mapbox.com/pricing | VERIFIED |
| MapTiler Flex | $30/mo incl. 25k sessions | free tier is **non-commercial only** | maptiler.com/pricing | VERIFIED |
| Stadia Maps Starter | $20/mo = 1M credits | free tier **non-commercial only** | stadiamaps.com/pricing | VERIFIED |
| OSM/Nominatim public API | $0 | 1 req/s; **autocomplete explicitly forbidden** | osmfoundation.org/policies/nominatim | VERIFIED |

### 4.11 Payments (Malawi)

| Provider | Fees | Setup/monthly | Notes | Source | Status |
|---|---|---|---|---|---|
| **Airtel Money MW (merchant API)** | **not published** — bilateral "Schedule II" | n/a | expect ~2–4% benchmark; MDR negotiable | airtel merchant T&C PDF; developers.airtel.africa | **UNVERIFIED** |
| **TNM Mpamba (merchant)** | **not published** | n/a | "Business Wallet (Micro Merchant)" T&C exists; call TNM | tnm.co.mw downloads | **UNVERIFIED** |
| **Flutterwave MW** | cards **4.8%** (local+intl); payouts: bank MK2,000/tx, mobile money 3% | none public | **registered with Reserve Bank of Malawi** | flutterwave.com/mw/pricing | VERIFIED |
| **PayChangu (MW)** | cards **3%**, mobile money **3%**, bank **2%** | not published | local aggregator | support.paychangu.com | PARTIAL/UNVERIFIED |
| **Pesapal MW** | **3.5%** per tx (group rate; MW may differ) | none public | MW entity exists; NBD settlement | pesapal.com PDF + /mw/ | VERIFIED (group rate) |
| DPO Group | custom quote | n/a | MW in instant-signup list | dpogroup.com/instant-signup | UNVERIFIED pricing |
| **Stripe / Paystack** | — | — | **Malawi NOT supported** (verified from their country lists) | stripe.com/global; paystack.com/countries | VERIFIED (unavailable) |
| PayPal | — | — | MW can pay in; MW merchant receiving unverified | paypal.com/country-worldwide | PARTIAL |
| NBM/Standard Bank merchant portal | "agreed between parties" | negotiable | real card-acquiring option; get 2–3 quotes | natbank.co.mw forms | UNVERIFIED |
| Mobile-money levy | 0.05% on transfers >MK100k | per tx | statutory, sender pays (payouts) | MRA March 2026 measures PDF | VERIFIED |

### 4.12 Push, monitoring, CI/CD, secrets, app stores

| Item | Free option | Paid option | Source | Status |
|---|---|---|---|---|
| Push (Android) | **FCM $0, unlimited** | — | firebase.google.com/pricing | VERIFIED |
| Push (iOS) | APNs free w/ Apple Developer | **$99/yr** membership | developer.apple.com/programs | VERIFIED |
| Expo/EAS builds+push | Free: 15 Android + 15 iOS builds/mo, 1k MAU | Starter $19/mo; Production $199/mo | expo.dev/pricing | VERIFIED |
| OneSignal | Free ≤1k push MAU | Growth $19/mo | onesignal.com/pricing | VERIFIED |
| Sentry | Developer: 5k errors, 1 user, free | Team $26/mo (50k); Business $80 | sentry.io/pricing | VERIFIED |
| Grafana Cloud | Free: 10k series, 50 GB ingest | Pro $19/mo + usage | grafana.com/pricing | VERIFIED |
| Axiom (logs) | Free: 500 GB/mo load | Cloud $25/mo | axiom.co/pricing | VERIFIED |
| Datadog | — | $15/host/mo (annual) | datadoghq.com/pricing | VERIFIED |
| UptimeRobot | Free: 50 monitors, 5-min | Solo $10/mo | uptimerobot.com/pricing | VERIFIED |
| Better Stack | Free: 10 monitors | +$25/mo per 50 | betterstack.com/pricing | VERIFIED |
| GitHub Actions | 2,000 min/mo (private); **unlimited public** | $0.006/min Linux overage | docs.github.com billing | VERIFIED |
| GHCR container registry | **currently free** | — | docs.github.com/packages | VERIFIED |
| Docker Hub | Free: 1 private repo | Pro $11/mo | docker.com/pricing | VERIFIED |
| Secrets | GitHub Actions secrets $0 | Doppler free ≤3 users; Vault $0 self-host | github.com/pricing; doppler.com | VERIFIED |
| **Google Play Console** | — | **$25 one-time** | support.google.com | VERIFIED |
| **Apple Developer Program** | — | **$99/yr** | developer.apple.com/programs/enroll | VERIFIED |
| App-store cut on BonAgri | **0%** (physical-goods marketplace; Play billing only mandatory for digital goods) | 15%/30% only if digital goods ever sold | support.google.com; apple guideline 3.1.1 (well-established) | VERIFIED / UNVERIFIED (Apple page not re-fetched) |

### 4.13 Malawi legal/compliance/logistics (one-time & annual)

| Item | Price | Period | Source | Status |
|---|---|---|---|---|
| Company incorporation (CRIPC) | MK75,000 ≈ **$43** (+ MK20,000 name reservation ≈ $11.50) | one-time | portal.trade.gov.mw (GN 43/2020) | VERIFIED |
| Annual return | MK20,000 ≈ $11.50 | annual | same | VERIFIED |
| Data Protection Act 2024 registration (controllers "of significant importance") | ~$29 (small) → >$4,000 (large) draft bands | annual | dpa.mw draft Registration Regs 2025; itweb.africa | **UNVERIFIED** (draft regs; reportedly mandatory from 2026-09-01) |
| Legal docs (T&C, privacy, refund) — lawyer | $300–1,500 | one-time | market estimate; must satisfy ETCSA 2016 + DPA 2024 | **UNVERIFIED** est |
| Legal docs — DIY templates + local review | $0–300 | one-time | est. | **UNVERIFIED** |
| ETCSA 2016 (Cap 74:02) compliance | $0 (product obligation) | — | malawilii.org | VERIFIED (law exists) |
| Urban delivery (indicative, no public rate cards exist) | MK3,000–10,000 ≈ $1.75–6/parcel intra-city; MK10,000–25,000 Blantyre↔Lilongwe | per parcel | market estimate (G4S/MPC/Speedex all quote-based) | **UNVERIFIED** est |

---

## 5. The quotation

Each scenario shows Budget / Recommended / Premium per category (monthly fixed unless noted), then totals.
Usage-based and per-transaction costs are listed **separately** after the fixed tables.

### 5.1 Launch / pilot — 200 buyers, 20 suppliers, 500 orders/mo, 2,000 images

| Category | Budget | Recommended | Premium |
|---|---|---|---|
| Hosting (API + web) | Render Hobby ×2 — **$0** (cold starts) | Render Starter ×2 — **$14** | Render Basic 1c-2g ×2 — **$50** |
| Database | Neon Free — **$0** (dev-grade) | Neon Launch (mostly suspended) — **~$10** | Render PG Basic — **$19 + storage** |
| Backups | R2 free tier — **$0** | R2 (2 GB) — **$1** | Neon snapshots — **~$2** |
| Images | Cloudinary Free — **$0** (25-credit ceiling) | Cloudinary Free — **$0** (monitor credits) | Cloudinary Plus (annual) — **$89** |
| CDN/SSL/DNS | Cloudflare Free — **$0** | Cloudflare Free — **$0** | Cloudflare Pro — **$25** |
| Transactional email | Resend Free — **$0** | Resend Free — **$0** (100/day cap: OK at 57/day avg) | Resend Pro — **$20** |
| Mailboxes (3 users) | Zoho Free — **$0** | Zoho Lite — **$5** | Google Workspace Starter — **$21** |
| Monitoring | Sentry Free + UptimeRobot Free — **$0** | same — **$0** | Sentry Team — **$26** |
| CI/CD + secrets | GitHub Actions free — **$0** | same — **$0** | same — **$0** |
| Domain (annual) | .mw retail — **~$55/yr** | .com transfer-in Cloudflare $10.46/yr + .mw (counted in annual) | GoDaddy .com renew ~$23/yr + aftermarket .com purchase (UNVERIFIED) |
| **Fixed monthly total** | **~$0** | **~$30** | **~$252** |

**One-time (Y1):** legal docs $800 (UNVERIFIED est, mid of range) + company registration ≈ $55 +
SMS sender ID ≈ $100 (UNVERIFIED; AT currently free) + Google Play $25 + **.mw 2-year registration
~$95** (registry 2-yr minimum + retail markup) = **$1,075**.
**Annual:** .com renewal $10 + data-protection reg ~$29 ≈ **$39** (.mw next renews in Y3; Apple $99
deferred until iOS ships).

**Usage / per-transaction (monthly, est.):**

| Driver | Quantity | Unit | Cost |
|---|---|---|---|
| Mobile-money fees (70%) | $10,500 GMV | ~3% (UNVERIFIED) | $315 |
| Card fees (20%) | $3,000 GMV | 4.8% (Flutterwave MW) | $144 |
| Supplier payouts (20 × 1) | 20 | $1.15 bank | $23 |
| SMS (Africa's Talking) | 1,000 | $0.013 | $13 |
| Email | within Resend Free | — | $0 |
| Maps | within Google free caps | — | $0 |
| Images | within 25 Cloudinary credits | — | $0 |
| **Usage total** | | | **~$495** |

**Scenario totals:** Year-1 = one-time 1,075 + fixed 30×12 + annual 39 + usage 495×12 = **$7,414**;
**+15% contingency = $8,526 ≈ MWK 14.8 M**. 3-year = 7,414 + 2×(30×12 + 495×12 + 39) = $20,092;
**+15% = $23,106 ≈ MWK 40.1 M**.

### 5.2 Growth — 2,000 buyers, 100 suppliers, 5,000 orders/mo, 10k images

| Category | Budget | Recommended | Premium |
|---|---|---|---|
| Hosting | Render Starter ×2 — **$14** | Render Basic 1c-2g ×2 — **$50** | Render Pro ×2 — **~$170** (UNVERIFIED est) |
| Database | Neon Launch (0.25 CU) — **~$20** | Neon Launch (0.5 CU + 15 GB) — **~$45** | Neon Scale / Supabase Pro+ — **~$100** (est.) |
| Backups | R2 (15 GB) — **$1** | R2 — **$1** | Neon snapshots — **~$5** |
| Images | Cloudinary Free — **$0** (⚠ 145 credits needed > 25 free) | Cloudinary Plus (annual) — **$89** | Cloudflare Images+R2 (migration) — **~$60** + eng. cost |
| CDN/SSL | Cloudflare Free — **$0** | Cloudflare Free — **$0** | Cloudflare Pro — **$25** |
| Email | Resend Pro — **$20** (Free's 100/day cap exceeded) | Resend Pro — **$20** | SendGrid Essentials — **$19.95** |
| Mailboxes | Zoho Lite ×3 — **$5** | Zoho Premium ×3 — **$12** | Google Workspace ×3 — **$21** |
| Monitoring | Sentry Free + UptimeRobot Free — **$0** | Sentry Team — **$26** | Sentry Team + Datadog — **$69** |
| CI/CD | GitHub Actions free — **$0** | same — **$0** | same — **$0** |
| Domain (annual) | ~$55/yr | $10 .com + $45 .mw (counted in annual) | + aftermarket .com (UNVERIFIED) |
| **Fixed monthly total** | **~$60** | **~$243** | **~$470** |

**One-time:** $0 (sender ID, legal, Play already bought at pilot). **Annual:** $10 .com + $45 .mw + $29 DPA + **$99 Apple** (iOS ships here) ≈ **$183**.

**Usage / per-transaction (monthly, est.):**

| Driver | Quantity | Unit | Cost |
|---|---|---|---|
| Mobile-money fees (70%) | $105,000 GMV | ~3% | $3,150 |
| Card fees (20%) | $30,000 GMV | 4.8% | $1,440 |
| Supplier payouts (100) | 100 | $1.15 | $115 |
| SMS (AT, basic tier) | 10,000 | $0.013 | $130 |
| Email overage | within Pro 50k | — | $0 |
| Maps | within free caps (10k/SKU) | — | $0 |
| Images | within Plus 225 credits (~145 used) | — | $0 |
| **Usage total** | | | **~$4,835** |

**Scenario totals:** Year-1 = 243×12 + 183 + 4,835×12 = **$61,119**; **+12% contingency = $68,453 ≈ MWK 118.7 M**.
3-year = 61,119×3 = $183,357; **+12% = $205,360 ≈ MWK 356.1 M**.

### 5.3 Scale — 20,000 buyers, 500 suppliers, 50,000 orders/mo, 100k images

| Category | Budget | Recommended | Premium |
|---|---|---|---|
| Hosting | Render Basic ×2 — **$50** | Render Pro (API) + Basic (web) — **~$110** | Render Pro ×2 + in-region DO Cape Town standby — **~$200** |
| Database | Neon Launch — **~$60** | Neon Scale (1 CU, 50 GB) — **~$180** | DO/AWS af-south-1 managed PG (RDS est. $70 + storage) — **~$85–110** but UNVERIFIED + ops |
| Backups | R2 (50 GB) — **$2** | R2 — **$2** | Neon snapshots + B2 — **~$6** |
| Images | Cloudinary Plus — **$99** (⚠ ~550 credits needed > 225) | Cloudinary Advanced (annual) — **$249** | Cloudinary Enterprise — **custom (UNVERIFIED)** |
| CDN | Cloudflare Free — **$0** | Cloudflare Free — **$0** | Cloudflare Pro — **$25** |
| Email | Resend Pro — **$20** | Resend Pro — **$20** (overage $90 in usage below) | Postmark/SendGrid dedicated-IP tier — **$130+** |
| Mailboxes (10 users) | Zoho Premium — **$40** | Zoho Premium — **$40** | Google Workspace — **$70** |
| Monitoring | Sentry Team + UptimeRobot — **$36** | Sentry Team + UptimeRobot Solo — **$36** | Sentry Business + Datadog — **$166** |
| CI/CD | free + overage — **$6** | $6 | $6 |
| Domain (annual) | ~$55/yr | $10 .com + $45 .mw (counted in annual) | + aftermarket .com (UNVERIFIED) |
| **Fixed monthly total** | **~$313** | **~$643** | **~$962** (Enterprise images priced as Advanced placeholder) |

**One-time:** $0. **Annual:** $183 (same as Growth).

**Usage / per-transaction (monthly, est.):**

| Driver | Quantity | Unit | Cost |
|---|---|---|---|
| Mobile-money fees (70%) | $1,050,000 GMV | ~3% | $31,500 |
| Card fees (20%) | $300,000 GMV | 4.8% | $14,400 |
| Supplier payouts (500) | 500 | $1.15 (+0.05% levy on large) | $575 |
| SMS (AT, volume tier) | 100,000 | ~$0.010–0.013 | ~$1,050 |
| Email overage | 100k extra | $0.90/1k | $90 |
| Maps (if built; Google beyond free caps) | 20k geocode + 20k elements + 10k loads | $5/$5/$7 per 1k | ~$220 (or ~$100 Mapbox) |
| **Usage total** | | | **~$47,835** |

**Scenario totals:** Year-1 = 643×12 + 183 + 47,835×12 = **$581,919**; **+10% contingency = $640,111 ≈ MWK 1,110.0 M**.
3-year = 581,919×3 = $1,745,757; **+10% = $1,920,333 ≈ MWK 3,329.9 M**.

---

## 6. Cost drivers and risks

1. **Payment MDRs (dominant, ~93–99% of Growth/Scale spend).** Unpublished for Airtel/TNM — the number
   you negotiate moves the entire budget. **Control:** push wallet payments (70% mix assumption),
   negotiate volume tiers, benchmark PayChangu 3% vs Flutterwave 4.8% vs Pesapal 3.5%, keep COD lean
   (it costs logistics + risk, not MDR). A 0.5pp reduction at Scale saves **~$75k/yr**.
2. **SMS.** 2 messages/order × 50k orders = 100k SMS/mo; international aggregators would cost 7–25×
   local rates ($11k vs $1.05k/mo). **Control:** Africa's Talking/Yoola only; batch promotional sends;
   cap OTP resends (login rate-limiter already exists); move low-urgency updates to push (free).
3. **Cloudinary credits.** 100k images × 10 transforms + 500 GB delivery breaches even Advanced's 600
   credits. **Control:** aggressive `w_`/`q_auto/f_auto` (already the plan), immutable cache headers,
   consider Cloudflare Images over R2 at Scale (~$60 + migration engineering) — or negotiate Cloudinary.
4. **Database size — CP15b delivery photos in `bytea`.** 2 photos × 300 KB × 50k orders = **30 GB/month**
   of DB growth at Scale (Neon $0.35/GB-mo ≈ $126/mo at 360 GB/yr, plus backup duplication).
   **Control:** move delivery photos to R2/Cloudinary at Growth, keep only the reference in Postgres.
5. **Maps.** Post-2025 Google billing has no $200 credit; heavy feature use at Scale ≈ $220/mo and
   unbudgeted keys can run away (budgets are email-only alerts, not caps). **Control:** session tokens
   for autocomplete, quota limits (hard caps) on the key, Static Maps instead of JS maps where possible,
   Mapbox fallback (50k free loads).
6. **Render free-tier cold starts** and **Neon autosuspend** — fine for dev, hostile to a live
   marketplace; the jump from $0 → $30/mo (pilot Recommended) buys the reliability.
7. **FX & tax friction:** +2–5% card/FX markup (est.), possible 15% WHT on foreign SaaS (UNVERIFIED),
   17.5% VAT once you cross MK50m turnover + mandatory MRA e-invoicing (integration cost).
8. **bonagri.com aftermarket purchase** (§9 Q1) — a wildcard one-time that could dwarf everything else.

## 7. Savings opportunities & free tiers worth using

- **Cloudflare Free**: CDN + SSL + DNS + DDoS — $0 forever; pairs with R2's free egress.
- **Cloudinary Free 25 credits** covers the pilot (~25k transforms or 25 GB delivery).
- **Resend Free 3,000/mo** covers pilot email; watch the 100/day cap on launch spikes.
- **Google Maps free caps** (10,000 events/SKU/mo) cover all usage until Scale — no card needed to start
  with a Maps Demo Key.
- **GitHub Actions free 2,000 min/mo** (or unlimited if repo is public) + **GHCR currently free**.
- **Sentry Developer + UptimeRobot Free + Axiom Free** = complete monitoring at $0.
- **FCM $0 unlimited** push; **Expo Free** covers 15 builds/mo — defer EAS paid plans.
- **SMS: local providers save 7–25×** vs Twilio/Vonage for the same delivery.
- **Zoho Mail Free** (5 users) beats paying from day one.
- **.mw registry direct fee is $40/yr** — defend the name even while .com is unresolved.

## 8. Items you must action externally (with lead times)

| # | Action | Where | Lead time | Cost |
|---|---|---|---|---|
| 1 | Resolve bonagri.com: negotiate Afternic purchase **or** accept .mw/.co.mw | afternic.com / GoDaddy seller | days–weeks (negotiation) | $0–negotiated / $45–60 per .mw |
| 2 | Register bonagri.mw + bonagri.co.mw (available today — first-come) | accredited .mw registrar | days | ~$80–120 (2-yr min) |
| 3 | Airtel Money merchant onboarding (+ API access) | Airtel Money MW merchant desk | 2–6 weeks | unpublished MDR |
| 4 | TNM Mpamba Business Wallet (Micro Merchant) | TNM Mpamba Ltd, Blantyre | 2–6 weeks | unpublished MDR |
| 5 | Flutterwave MW + PayChangu accounts (cards) | flutterwave.com/mw, paychangu.com | 1–3 weeks | 4.8% / 3% |
| 6 | SMS sender ID registration (Airtel+TNM) | Africa's Talking / MACRA | 1–4 weeks | ~$0–100 (UNVERIFIED) |
| 7 | Create SaaS accounts: Render, Neon, Cloudflare, Resend, Cloudinary, Sentry, UptimeRobot, GitHub org | respective sites | 1 day | $0 |
| 8 | Google Cloud billing account + Maps key w/ **quota hard caps** | cloud.google.com | 1 day | $0 within caps |
| 9 | Company registration (CRIPC) + tax registration | CRIPC, Blantyre | 2–8 weeks | ~$54 |
| 10 | Data Protection Authority registration (draft regs reportedly mandatory from Sept 2026) | dpa.mw | weeks | ~$29+ (UNVERIFIED) |
| 11 | Legal docs (T&C/privacy/refund per ETCSA 2016 + DPA 2024) | local lawyer | 2–6 weeks | $300–1,500 |
| 12 | Google Play Developer account (when app ships) | play.google.com/console | 1–3 days (+ID verify) | $25 one-time |
| 13 | Apple Developer Program (when iOS ships) | developer.apple.com | 1–48h (entity review longer) | $99/yr |

## 9. Open questions that would change the numbers

1. **Who owns bonagri.com?** WHOIS says registered 2023-07-19 (GoDaddy) and parked on **Afternic — i.e.
   listed for sale**. If it's yours, renewal is $10–23/yr. If not, aftermarket price is negotiable and
   unquoted (could be $500 or $50k). If it can't be had, the brand lives on **bonagri.mw** ($40–60/yr).
2. **Airtel/TNM merchant MDRs** — the published fee is bilateral. Your quotes move total cost by tens of
   percent at Growth/Scale. Where to check: Airtel merchant T&C "Schedule II", Airtel Money merchant
   desk, TNM Mpamba T&C PDF (tnm.co.mw downloads), both enterprise sales teams.
3. **Is SMS in the MVP?** $13/mo pilot is trivial, but at Scale it's ~$1.05k/mo. If push + email cover
   order updates, delete this line.
4. **Will you ship the mobile app in year 1?** Adds Apple $99/yr + Play $25 + Expo build budget; PWA-only
   removes them.
5. **Real GMV and payment mix** — AOV $30 and 70/20/10 wallet/card/COD are assumptions. Every 1pp of
   blended MDR ≈ $15/mo at pilot, $150/mo at Growth, $1,500/mo at Scale.
6. **South Africa vs Malawi mismatch** — repo seeds ZAR-style prices and `en-ZA` locale, Ozow/PayFast
   enums. Is Malawi replacing the SA target, or is this a second market? MWK currency formatting,
   MW payment rails, and address model changes are engineering items not in this budget.
7. **Delivery photos (CP15b) — stay in Postgres or move to object storage?** In-DB bytea adds ~$126/mo
   DB cost at Scale and complicates Neon branching; storage migration is ~1 day of work if decided now.
8. **VAT registration + MRA Electronic Invoicing** — triggered at MK50m turnover; EIS integration is a
   development item (fine possible: MK5m). When do you expect to cross it?
9. **Withholding tax on foreign SaaS** — confirm with a Malawian accountant whether 15% WHT applies to
   Render/Cloudinary/etc. fees; if so, either budget +15% on foreign SaaS or gross-up clauses.
10. **Public or private repo?** A public repo makes CI literally $0 and removes minute worries.

---
*Methodology: repo audit performed on the working tree at CP16a+hardening (commit `45431b8`); ~75
providers researched via their official pricing pages/docs on 2026-10-22; every UNVERIFIED row is
explicitly marked with an estimate and where to confirm it. Companion data file:
[`COST_QUOTATION.csv`](./COST_QUOTATION.csv).*
