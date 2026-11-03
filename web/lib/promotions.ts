// Shared marketplace-promotion types + lightweight analytics.
//
// Public payloads are produced by api/src/promotions/promotions.service.ts.
// Only public fields exist here — admin metrics never reach this module.

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

export type PromoPlacement =
  | "HOME_TOP"
  | "HOME_MID"
  | "EXPLORE_TOP"
  | "EXPLORE_MID";

export type PromoCampaignType =
  | "FEATURED_PRODUCTS"
  | "NEAR_YOU"
  | "SPECIAL_OFFERS"
  | "DISCOVER_CATEGORIES"
  | "FEATURED_SHOPS";

export type PromoCardLayout =
  | "BANNER"
  | "SPLIT"
  | "COMPACT"
  | "EDITORIAL"
  | "CAROUSEL";

export type PromoProduct = {
  id: string;
  name: string;
  slug: string;
  price: string;
  promoPrice: string | null;
  discountPercent: number | null;
  imageUrl: string | null;
  unit: string;
  supplierId: string;
  supplierName: string;
  supplierCity: string | null;
  supplierProvince: string | null;
  availableQuantity: number;
  distanceKm: number | null;
};

export type PromoDestination =
  | { type: "PRODUCT"; productId: string; url: string }
  | { type: "CATEGORY"; categoryId: string; url: string }
  | { type: "SHOP"; shopId: string; url: string };

export type PublicPromotion = {
  id: string;
  name: string;
  headline: string;
  description: string | null;
  type: PromoCampaignType;
  layout: PromoCardLayout;
  placement: PromoPlacement;
  priority: number;
  ctaText: string;
  tone: string | null;
  isSponsored: boolean;
  startAt: string | null;
  expiresAt: string | null;
  destination: PromoDestination;
  images: Array<{ id: string; url: string; alt: string | null }>;
  heroImageUrl: string | null;
  products: PromoProduct[];
  category: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string | null;
  } | null;
  shop: {
    id: string;
    name: string;
    description: string | null;
    logoUrl: string | null;
    city: string | null;
    province: string | null;
    verified: boolean;
    productCount: number;
  } | null;
  nearYou: {
    needsLocation: boolean;
    locationLabel: string | null;
    locationOptions: string[];
  } | null;
};

export type PromotionLocation = {
  city?: string;
  lat?: number;
  lng?: number;
};

export async function fetchPromotions(
  placement: PromoPlacement,
  location: PromotionLocation = {},
  signal?: AbortSignal,
): Promise<PublicPromotion[]> {
  const params = new URLSearchParams({ placement, limit: "4" });
  if (location.city) params.set("city", location.city);
  if (location.lat !== undefined) params.set("lat", String(location.lat));
  if (location.lng !== undefined) params.set("lng", String(location.lng));

  const response = await fetch(
    `${API_BASE_URL}/api/promotions?${params.toString()}`,
    { cache: "no-store", signal },
  );

  if (!response.ok) {
    throw new Error("Promotions are unavailable");
  }

  return (await response.json()) as PublicPromotion[];
}

// ── Analytics ───────────────────────────────────────────────────────────────
// Impressions are one per campaign per browser session and batched; clicks are
// sent immediately with keepalive so navigation cannot drop them.

type PromoEvent = {
  campaignId: string;
  type: "IMPRESSION" | "CLICK";
  eventKey: string;
};

const SESSION_KEY = "bonagri.promo.session";
const seenImpressions = new Set<string>();
let queue: PromoEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function sessionId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return "anonymous";
  }
}

async function send(events: PromoEvent[], keepalive = false) {
  if (events.length === 0) return;
  try {
    await fetch(`${API_BASE_URL}/api/promotions/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive,
    });
  } catch {
    // Analytics is best-effort; the marketplace must never depend on it.
  }
}

function scheduleFlush() {
  if (typeof window === "undefined" || flushTimer) return;
  flushTimer = setTimeout(() => {
    const batch = queue;
    queue = [];
    flushTimer = null;
    void send(batch);
  }, 1500);
}

export function trackPromotionImpression(campaignId: string) {
  if (typeof window === "undefined") return;
  const key = `${campaignId}:imp:${sessionId()}`;
  if (seenImpressions.has(key)) return;
  seenImpressions.add(key);
  queue.push({ campaignId, type: "IMPRESSION", eventKey: key });
  scheduleFlush();
}

export function trackPromotionClick(campaignId: string) {
  if (typeof window === "undefined") return;
  const event: PromoEvent = {
    campaignId,
    type: "CLICK",
    eventKey: `${campaignId}:click:${sessionId()}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  };
  void send([event], true);
}
