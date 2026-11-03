"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buildImageUrl } from "../../lib/media";
import {
  trackPromotionClick,
  trackPromotionImpression,
  type PromoProduct,
  type PublicPromotion,
} from "../../lib/promotions";
import { ArrowRightIcon } from "../mobile/icons";

const TONE_CLASSES: Record<string, string> = {
  "from-[#17633a] to-[#0c3f23]":
    "bg-gradient-to-br from-[#17633a] to-[#0c3f23]",
  "from-[#1f7a45] to-[#113f27]":
    "bg-gradient-to-br from-[#1f7a45] to-[#113f27]",
  "from-[#166b3c] to-[#0e3a22]":
    "bg-gradient-to-br from-[#166b3c] to-[#0e3a22]",
  "from-[#8c6d1f] to-[#4d3807]":
    "bg-gradient-to-br from-[#8c6d1f] to-[#4d3807]",
  "from-[#633a17] to-[#361d08]":
    "bg-gradient-to-br from-[#633a17] to-[#361d08]",
};

const FALLBACK_TONE = "bg-gradient-to-br from-[#17633a] to-[#0c3f23]";

const TYPE_LABELS: Record<PublicPromotion["type"], string> = {
  FEATURED_PRODUCTS: "Featured",
  NEAR_YOU: "Near you",
  SPECIAL_OFFERS: "Special offer",
  DISCOVER_CATEGORIES: "Discover",
  FEATURED_SHOPS: "Featured shop",
};

function toneClass(tone: string | null | undefined) {
  return (tone && TONE_CLASSES[tone]) || FALLBACK_TONE;
}

function formatPrice(value: string) {
  return `R ${Number(value).toFixed(2)}`;
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
  });
}

function Chip({
  children,
  tone = "light",
}: {
  children: React.ReactNode;
  tone?: "light" | "overlay" | "accent";
}) {
  const classes =
    tone === "overlay"
      ? "bg-white/15 text-white backdrop-blur-sm"
      : tone === "accent"
        ? "bg-[#e2f0e4] text-[#17633a]"
        : "bg-[#f1f4ef] text-[#526054]";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${classes}`}
    >
      {children}
    </span>
  );
}

function PromotionMedia({
  promotion,
  className = "",
  preview,
}: {
  promotion: PublicPromotion;
  className?: string;
  preview?: boolean;
}) {
  const images =
    promotion.images.length > 0
      ? promotion.images
      : promotion.heroImageUrl
        ? [
            {
              id: "hero",
              url: promotion.heroImageUrl,
              alt: promotion.headline,
            },
          ]
        : [];

  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const programmaticScroll = useRef(false);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function scrollToSlide(next: number) {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;

    programmaticScroll.current = true;
    track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
    window.setTimeout(() => {
      programmaticScroll.current = false;
    }, 800);
    setIndex(next);
  }

  useEffect(() => {
    if (preview || images.length <= 1 || paused || !visible) return;

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setIndex((current) => {
        const next = (current + 1) % images.length;
        scrollToSlide(next);
        return next;
      });
    }, 5200);

    return () => window.clearInterval(timer);
  }, [preview, images.length, paused, visible]);

  function handleScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    setIndex(Math.round(track.scrollLeft / track.clientWidth));
    if (!programmaticScroll.current) setPaused(true);
  }

  function goToSlide(next: number) {
    setPaused(true);
    scrollToSlide(next);
  }

  return (
    <div
      ref={rootRef}
      className={`overflow-hidden ${toneClass(promotion.tone)} ${className}`}
    >
      <div
        ref={trackRef}
        onScroll={handleScroll}
        onPointerDown={() => setPaused(true)}
        onWheel={(event) => {
          if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
            setPaused(true);
          }
        }}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm font-bold text-white/70">
            {promotion.headline}
          </div>
        ) : (
          images.map((image, imageIndex) => (
            <div
              key={image.id}
              className="relative h-full w-full shrink-0 snap-start overflow-hidden"
            >
              {!failed[image.url] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={buildImageUrl(image.url, 960) ?? image.url}
                  alt={image.alt || promotion.headline}
                  loading={imageIndex === 0 ? "eager" : "lazy"}
                  decoding="async"
                  onError={() =>
                    setFailed((current) => ({
                      ...current,
                      [image.url]: true,
                    }))
                  }
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm font-bold text-white/70">
                  {promotion.headline}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {images.length > 1 ? (
        <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-black/30 px-2 py-1.5 backdrop-blur-sm">
          {images.map((image, imageIndex) => (
            <button
              key={image.id}
              type="button"
              onClick={() => goToSlide(imageIndex)}
              aria-label={`Show promotion image ${imageIndex + 1}`}
              aria-current={imageIndex === index}
              className={`h-1.5 rounded-full transition-all ${
                imageIndex === index ? "w-4 bg-white" : "w-1.5 bg-white/50"
              }`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PromoProductCard({
  product,
  campaignId,
  overlay,
  preview,
}: {
  product: PromoProduct;
  campaignId: string;
  overlay: boolean;
  preview?: boolean;
}) {
  const inner = (
    <>
      <div
        className={`relative h-16 w-full overflow-hidden rounded-lg ${
          overlay ? "bg-white/10" : "bg-[#f1f4ef]"
        }`}
      >
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={buildImageUrl(product.imageUrl, 240) ?? product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center text-xs font-black ${
              overlay ? "text-white/60" : "text-[#526054]"
            }`}
          >
            {product.name.slice(0, 1)}
          </div>
        )}

        {product.discountPercent !== null ? (
          <span className="absolute left-1 top-1 rounded-full bg-[#c2410c] px-1.5 py-0.5 text-[8px] font-black text-white">
            -{product.discountPercent}%
          </span>
        ) : null}
      </div>

      <div className="mt-1.5 min-w-0">
        <div
          className={`truncate text-[10px] font-bold ${
            overlay ? "text-white" : "text-[#243229]"
          }`}
        >
          {product.name}
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-1">
          {product.promoPrice ? (
            <>
              <span
                className={`text-[11px] font-black ${
                  overlay ? "text-[#f7e0a1]" : "text-[#c2410c]"
                }`}
              >
                {formatPrice(product.promoPrice)}
              </span>
              <span
                className={`text-[9px] line-through ${
                  overlay ? "text-white/60" : "text-[#8b958d]"
                }`}
              >
                {formatPrice(product.price)}
              </span>
            </>
          ) : (
            <span
              className={`text-[11px] font-black ${
                overlay ? "text-white" : "text-[#17633a]"
              }`}
            >
              {formatPrice(product.price)}
            </span>
          )}
        </div>
        <div
          className={`truncate text-[9px] ${
            overlay ? "text-white/60" : "text-[#8b958d]"
          }`}
        >
          {product.distanceKm !== null
            ? `${product.distanceKm} km away`
            : product.supplierName}
        </div>
      </div>
    </>
  );

  const className = `w-28 shrink-0 rounded-xl border p-1.5 transition ${
    overlay
      ? "border-white/15 bg-white/10 hover:bg-white/15"
      : "border-[#e4e8e1] bg-white hover:border-[#c7d3c4] hover:shadow-sm"
  }`;

  if (preview) {
    return <div className={className}>{inner}</div>;
  }

  return (
    <Link
      href={`/products/${product.id}`}
      onClick={() => trackPromotionClick(campaignId)}
      className={className}
    >
      {inner}
    </Link>
  );
}

function ProductStrip({
  promotion,
  overlay,
  preview,
}: {
  promotion: PublicPromotion;
  overlay: boolean;
  preview?: boolean;
}) {
  if (promotion.products.length === 0) return null;

  return (
    <div
      className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Promoted products"
    >
      {promotion.products.slice(0, 6).map((product) => (
        <PromoProductCard
          key={product.id}
          product={product}
          campaignId={promotion.id}
          overlay={overlay}
          preview={preview}
        />
      ))}
    </div>
  );
}

function LocationPrompt({
  promotion,
  overlay,
  locating,
  locationError,
  onLocationChange,
  onUseLocation,
  preview,
}: {
  promotion: PublicPromotion;
  overlay: boolean;
  locating?: boolean;
  locationError?: string;
  onLocationChange?: (city: string) => void;
  onUseLocation?: () => void;
  preview?: boolean;
}) {
  const [city, setCity] = useState("");
  const options = promotion.nearYou?.locationOptions ?? [];

  return (
    <div
      className={`mt-3 rounded-2xl border p-3 ${
        overlay
          ? "border-white/15 bg-white/10"
          : "border-[#e4e8e1] bg-[#f8faf6]"
      }`}
    >
      <div
        className={`text-[11px] font-black ${
          overlay ? "text-white" : "text-[#243229]"
        }`}
      >
        See what is near you
      </div>
      <p
        className={`mt-0.5 text-[10px] leading-4 ${
          overlay ? "text-white/70" : "text-[#69756c]"
        }`}
      >
        Choose an area or share your location — only when you tap the button.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={city}
          disabled={preview}
          onChange={(event) => {
            const next = event.target.value;
            setCity(next);
            if (next) onLocationChange?.(next);
          }}
          aria-label="Choose a nearby area"
          className={`h-9 min-w-0 flex-1 rounded-lg border px-2 text-[11px] font-semibold outline-none ${
            overlay
              ? "border-white/20 bg-white/10 text-white"
              : "border-[#d5ddd3] bg-white text-[#334138]"
          }`}
        >
          <option value="">Choose an area</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={preview || locating}
          onClick={onUseLocation}
          className={`h-9 rounded-lg px-3 text-[10px] font-black uppercase tracking-wide transition ${
            overlay
              ? "bg-white text-[#17633a] hover:bg-white/90"
              : "bg-[#17633a] text-white hover:bg-[#0f4d2b]"
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {locating ? "Locating…" : "Use my location"}
        </button>
      </div>

      {locationError ? (
        <p className="mt-2 text-[10px] font-semibold text-red-200">
          {locationError}
        </p>
      ) : null}
    </div>
  );
}

function CampaignBody({
  promotion,
  overlay,
  preview,
  locating,
  locationError,
  onLocationChange,
  onUseLocation,
}: {
  promotion: PublicPromotion;
  overlay: boolean;
  preview?: boolean;
  locating?: boolean;
  locationError?: string;
  onLocationChange?: (city: string) => void;
  onUseLocation?: () => void;
}) {
  if (promotion.type === "NEAR_YOU") {
    if (promotion.nearYou?.needsLocation) {
      return (
        <LocationPrompt
          promotion={promotion}
          overlay={overlay}
          locating={locating}
          locationError={locationError}
          onLocationChange={onLocationChange}
          onUseLocation={onUseLocation}
          preview={preview}
        />
      );
    }

    return (
      <>
        {promotion.nearYou?.locationLabel ? (
          <div
            className={`mt-2 text-[10px] font-bold ${
              overlay ? "text-white/70" : "text-[#69756c]"
            }`}
          >
            Near {promotion.nearYou.locationLabel}
          </div>
        ) : null}
        <ProductStrip
          promotion={promotion}
          overlay={overlay}
          preview={preview}
        />
      </>
    );
  }

  if (promotion.type === "FEATURED_SHOPS") {
    return (
      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-[11px] font-black ${
              overlay ? "text-white" : "text-[#243229]"
            }`}
          >
            {promotion.shop?.name}
          </span>
          {promotion.shop?.verified ? <Chip tone="accent">Verified</Chip> : null}
          {promotion.shop?.city ? (
            <span
              className={`text-[10px] ${
                overlay ? "text-white/60" : "text-[#8b958d]"
              }`}
            >
              {promotion.shop.city}
              {promotion.shop.province ? `, ${promotion.shop.province}` : ""}
            </span>
          ) : null}
        </div>
        <ProductStrip
          promotion={promotion}
          overlay={overlay}
          preview={preview}
        />
      </div>
    );
  }

  if (promotion.type === "DISCOVER_CATEGORIES") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Chip tone={overlay ? "overlay" : "accent"}>
          {promotion.category?.name ?? "Category"}
        </Chip>
      </div>
    );
  }

  return (
    <ProductStrip promotion={promotion} overlay={overlay} preview={preview} />
  );
}

function CampaignBadges({
  promotion,
  overlay,
}: {
  promotion: PublicPromotion;
  overlay: boolean;
}) {
  const maxDiscount = promotion.products.reduce(
    (max, product) => Math.max(max, product.discountPercent ?? 0),
    0,
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {promotion.isSponsored ? (
        <Chip tone={overlay ? "overlay" : "light"}>Sponsored</Chip>
      ) : null}
      <Chip tone={overlay ? "overlay" : "accent"}>
        {TYPE_LABELS[promotion.type]}
      </Chip>
      {maxDiscount > 0 ? (
        <Chip tone={overlay ? "overlay" : "accent"}>Up to {maxDiscount}% off</Chip>
      ) : null}
    </div>
  );
}

function CampaignCta({
  promotion,
  overlay,
  preview,
}: {
  promotion: PublicPromotion;
  overlay: boolean;
  preview?: boolean;
}) {
  const label =
    promotion.type === "DISCOVER_CATEGORIES"
      ? "Browse category"
      : promotion.type === "FEATURED_SHOPS"
        ? "Visit shop"
        : promotion.ctaText || "View offer";

  const className = `mt-3 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-black transition ${
    overlay
      ? "bg-white text-[#17633a] hover:bg-white/90"
      : "bg-[#17633a] text-white hover:bg-[#0f4d2b]"
  }`;

  if (preview) {
    return (
      <span className={className}>
        {label}
        <ArrowRightIcon className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <Link
      href={promotion.destination.url}
      onClick={() => trackPromotionClick(promotion.id)}
      className={className}
    >
      {label}
      <ArrowRightIcon className="h-3.5 w-3.5" />
    </Link>
  );
}

export default function PromotionCard({
  promotion,
  preview = false,
  locating,
  locationError,
  onLocationChange,
  onUseLocation,
}: {
  promotion: PublicPromotion;
  preview?: boolean;
  locating?: boolean;
  locationError?: string;
  onLocationChange?: (city: string) => void;
  onUseLocation?: () => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const needsLocation =
    promotion.type === "NEAR_YOU" && promotion.nearYou?.needsLocation;

  useEffect(() => {
    if (preview) return;
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && entries[0].intersectionRatio >= 0.5) {
          trackPromotionImpression(promotion.id);
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [promotion.id, preview]);

  const expiry = formatDate(promotion.expiresAt);

  if (promotion.layout === "BANNER") {
    return (
      <article
        ref={rootRef}
        className="relative min-h-[214px] overflow-hidden rounded-3xl shadow-sm"
      >
        <PromotionMedia
          promotion={promotion}
          className="absolute inset-0"
          preview={preview}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
        <div className="relative z-10 flex min-h-[214px] flex-col justify-end p-5 text-white">
          <CampaignBadges promotion={promotion} overlay />
          <h3 className="mt-2 text-xl font-black leading-tight tracking-tight">
            {promotion.headline}
          </h3>
          {promotion.description ? (
            <p className="mt-1 line-clamp-2 max-w-md text-[11px] leading-5 text-white/80">
              {promotion.description}
            </p>
          ) : null}
          <CampaignBody
            promotion={promotion}
            overlay
            preview={preview}
            locating={locating}
            locationError={locationError}
            onLocationChange={onLocationChange}
            onUseLocation={onUseLocation}
          />
          {!needsLocation ? (
            <div className="flex items-center gap-3">
              <CampaignCta promotion={promotion} overlay preview={preview} />
              {expiry ? (
                <span className="text-[10px] font-semibold text-white/70">
                  Ends {expiry}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  if (promotion.layout === "COMPACT") {
    return (
      <article
        ref={rootRef}
        className="flex gap-3 rounded-2xl border border-[#e1e6dd] bg-white p-3 shadow-sm"
      >
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl">
          <PromotionMedia
            promotion={promotion}
            className="absolute inset-0"
            preview={preview}
          />
        </div>
        <div className="min-w-0 flex-1">
          <CampaignBadges promotion={promotion} overlay={false} />
          <h3 className="mt-1.5 line-clamp-2 text-sm font-black leading-tight text-[#243229]">
            {promotion.headline}
          </h3>
          {promotion.description ? (
            <p className="mt-0.5 line-clamp-1 text-[10px] leading-4 text-[#69756c]">
              {promotion.description}
            </p>
          ) : null}
          {!needsLocation ? (
            <CampaignCta promotion={promotion} overlay={false} preview={preview} />
          ) : (
            <div className="mt-2 text-[10px] font-bold text-[#17633a]">
              Choose an area to see nearby products
            </div>
          )}
        </div>
      </article>
    );
  }

  // SPLIT / EDITORIAL / CAROUSEL share the stacked card shell.
  const mediaHeight =
    promotion.layout === "EDITORIAL"
      ? "aspect-[16/6]"
      : promotion.layout === "CAROUSEL"
        ? "aspect-[16/7]"
        : "aspect-[16/9]";

  return (
    <article
      ref={rootRef}
      className={`overflow-hidden rounded-3xl border border-[#e1e6dd] bg-white shadow-sm ${
        promotion.layout === "SPLIT" ? "sm:grid sm:grid-cols-2" : ""
      }`}
    >
      <div
        className={`relative ${mediaHeight} ${
          promotion.layout === "SPLIT" ? "sm:h-full sm:min-h-[230px]" : ""
        }`}
      >
        <PromotionMedia
          promotion={promotion}
          className="absolute inset-0"
          preview={preview}
        />
      </div>

      <div className="p-4 sm:p-5">
        <CampaignBadges promotion={promotion} overlay={false} />
        <h3 className="mt-2 text-lg font-black leading-tight tracking-tight text-[#243229]">
          {promotion.headline}
        </h3>
        {promotion.description ? (
          <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[#69756c]">
            {promotion.description}
          </p>
        ) : null}

        <CampaignBody
          promotion={promotion}
          overlay={false}
          preview={preview}
          locating={locating}
          locationError={locationError}
          onLocationChange={onLocationChange}
          onUseLocation={onUseLocation}
        />

        {!needsLocation ? (
          <div className="flex items-center gap-3">
            <CampaignCta promotion={promotion} overlay={false} preview={preview} />
            {expiry ? (
              <span className="mt-3 text-[10px] font-semibold text-[#8b958d]">
                Ends {expiry}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
