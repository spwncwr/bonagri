"use client";

import { useState } from "react";
import ImageUpload from "../media/image-upload";
import { ArrowLeftIcon, ArrowRightIcon } from "../mobile/icons";
import { buildImageUrl } from "../../lib/media";
import type {
  PromoCampaignType,
  PromoCardLayout,
  PromoPlacement,
} from "../../lib/promotions";

export type PromoOptions = {
  products: Array<{
    id: string;
    name: string;
    price: string;
    unit: string;
    imageUrl: string | null;
    categoryName: string;
    supplierName: string;
  }>;
  categories: Array<{
    id: string;
    name: string;
    slug: string;
    imageUrl: string | null;
    productCount: number;
  }>;
  shops: Array<{
    id: string;
    name: string;
    description: string | null;
    logoUrl: string | null;
    city: string | null;
    province: string | null;
    verified: boolean;
    productCount: number;
  }>;
};

export type AdminCampaign = {
  id: string;
  name: string;
  headline: string;
  description: string | null;
  type: PromoCampaignType;
  status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "PAUSED";
  effectiveStatus: "DRAFT" | "SCHEDULED" | "ACTIVE" | "PAUSED" | "EXPIRED";
  layout: PromoCardLayout;
  placement: PromoPlacement;
  priority: number;
  ctaText: string;
  tone: string | null;
  isSponsored: boolean;
  startAt: string | null;
  expiresAt: string | null;
  destinationType: "PRODUCT" | "CATEGORY" | "SHOP" | "NONE";
  destinationId: string | null;
  images: Array<{ id: string; url: string; alt: string | null; sortOrder: number }>;
  products: Array<{
    productId: string;
    promoPrice: number | null;
    product: {
      id: string;
      name: string;
      price: string;
      unit: string;
      imageUrl: string | null;
      status: string;
      supplierName: string;
    };
  }>;
  impressions: number;
  clicks: number;
  clickThroughRate: number;
  createdAt: string;
  updatedAt: string;
};

export type CampaignFormValues = {
  name: string;
  headline: string;
  description: string;
  type: PromoCampaignType;
  status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "PAUSED";
  layout: PromoCardLayout;
  placement: PromoPlacement;
  priority: number;
  ctaText: string;
  tone: string;
  isSponsored: boolean;
  startAt: string;
  expiresAt: string;
  destinationType: "PRODUCT" | "CATEGORY" | "SHOP" | "NONE";
  destinationId: string;
  images: Array<{ url: string; alt: string }>;
  products: Array<{ productId: string; promoPrice: string }>;
};

export type CampaignFormAction = "draft" | "preview" | "schedule" | "publish";

export const TYPE_LABELS: Record<PromoCampaignType, string> = {
  FEATURED_PRODUCTS: "Featured products",
  NEAR_YOU: "Near you",
  SPECIAL_OFFERS: "Special offers",
  DISCOVER_CATEGORIES: "Discover categories",
  FEATURED_SHOPS: "Featured shops",
};

export const LAYOUT_LABELS: Record<PromoCardLayout, string> = {
  BANNER: "Large horizontal banner",
  SPLIT: "Split image / text",
  COMPACT: "Compact card",
  EDITORIAL: "Full-width editorial",
  CAROUSEL: "Swipeable carousel",
};

export const PLACEMENT_LABELS: Record<PromoPlacement, string> = {
  HOME_TOP: "Home listings — after 1st row",
  HOME_MID: "Home listings — after 2nd row",
  EXPLORE_TOP: "Explore listings — after 1st row",
  EXPLORE_MID: "Explore listings — after 2nd row",
};

export const TONE_PRESETS = [
  { label: "Deep Emerald", value: "from-[#17633a] to-[#0c3f23]" },
  { label: "Forest Green", value: "from-[#1f7a45] to-[#113f27]" },
  { label: "Rich Olive", value: "from-[#166b3c] to-[#0e3a22]" },
  { label: "Warm Gold", value: "from-[#8c6d1f] to-[#4d3807]" },
  { label: "Earth Brown", value: "from-[#633a17] to-[#361d08]" },
];

const INPUT =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
const LABEL = "mb-1 block text-xs font-medium text-slate-700";

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formValuesFromCampaign(campaign: AdminCampaign): CampaignFormValues {
  return {
    name: campaign.name,
    headline: campaign.headline,
    description: campaign.description ?? "",
    type: campaign.type,
    status: campaign.status,
    layout: campaign.layout,
    placement: campaign.placement,
    priority: campaign.priority,
    ctaText: campaign.ctaText,
    tone: campaign.tone ?? TONE_PRESETS[0].value,
    isSponsored: campaign.isSponsored,
    startAt: toLocalInput(campaign.startAt),
    expiresAt: toLocalInput(campaign.expiresAt),
    destinationType: campaign.destinationType,
    destinationId: campaign.destinationId ?? "",
    images: campaign.images.map((image) => ({
      url: image.url,
      alt: image.alt ?? "",
    })),
    products: campaign.products.map((link) => ({
      productId: link.productId,
      promoPrice:
        link.promoPrice === null ? "" : String(link.promoPrice),
    })),
  };
}

const EMPTY_FORM: CampaignFormValues = {
  name: "",
  headline: "",
  description: "",
  type: "FEATURED_PRODUCTS",
  status: "DRAFT",
  layout: "BANNER",
  placement: "HOME_TOP",
  priority: 10,
  ctaText: "View offer",
  tone: TONE_PRESETS[0].value,
  isSponsored: false,
  startAt: "",
  expiresAt: "",
  destinationType: "PRODUCT",
  destinationId: "",
  images: [],
  products: [],
};

function formatPrice(value: string | number) {
  return `R ${Number(value).toFixed(2)}`;
}

export default function PromotionForm({
  options,
  initial,
  busy,
  error,
  onAction,
  onCancelEdit,
}: {
  options: PromoOptions | null;
  initial?: AdminCampaign | null;
  busy: boolean;
  error: string;
  onAction: (values: CampaignFormValues, action: CampaignFormAction) => void;
  onCancelEdit?: () => void;
}) {
  const [values, setValues] = useState<CampaignFormValues>(
    () => (initial ? formValuesFromCampaign(initial) : EMPTY_FORM),
  );
  const [productSearch, setProductSearch] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const editing = Boolean(initial);
  const isOffer = values.type === "SPECIAL_OFFERS";
  const needsProducts =
    values.type === "FEATURED_PRODUCTS" ||
    values.type === "NEAR_YOU" ||
    values.type === "SPECIAL_OFFERS";
  const scheduleReady = Boolean(values.startAt);

  function patch(next: Partial<CampaignFormValues>) {
    setValues((current) => ({ ...current, ...next }));
  }

  function changeType(type: PromoCampaignType) {
    // The server derives these destinations from the campaign type.
    if (type === "DISCOVER_CATEGORIES") {
      patch({ type, destinationType: "CATEGORY", destinationId: "" });
      return;
    }
    if (type === "FEATURED_SHOPS") {
      patch({ type, destinationType: "SHOP", destinationId: "" });
      return;
    }
    patch({ type });
  }

  function addImage(url: string) {
    const trimmed = url.trim();
    if (!trimmed || values.images.some((image) => image.url === trimmed)) return;
    if (values.images.length >= 6) return;
    patch({ images: [...values.images, { url: trimmed, alt: "" }] });
    setImageUrl("");
  }

  function moveImage(index: number, direction: -1 | 1) {
    const next = [...values.images];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patch({ images: next });
  }

  function removeImage(index: number) {
    patch({ images: values.images.filter((_, i) => i !== index) });
  }

  function addProduct(productId: string) {
    if (!productId || values.products.some((item) => item.productId === productId)) {
      return;
    }
    if (values.products.length >= 12) return;
    patch({
      products: [...values.products, { productId, promoPrice: "" }],
    });
    setProductSearch("");
  }

  function setPromoPrice(productId: string, price: string) {
    patch({
      products: values.products.map((item) =>
        item.productId === productId ? { ...item, promoPrice: price } : item,
      ),
    });
  }

  function removeProduct(productId: string) {
    patch({
      products: values.products.filter((item) => item.productId !== productId),
    });
  }

  const selectedProducts = values.products
    .map((link) => ({
      link,
      option: options?.products.find((product) => product.id === link.productId),
    }))
    .filter((row) => Boolean(row.option));

  const productMatches = (options?.products ?? [])
    .filter((product) => {
      if (values.products.some((item) => item.productId === product.id)) {
        return false;
      }
      const query = productSearch.trim().toLowerCase();
      if (!query) return true;
      return `${product.name} ${product.categoryName} ${product.supplierName}`
        .toLowerCase()
        .includes(query);
    })
    .slice(0, 30);

  const destinationOptions =
    values.destinationType === "PRODUCT"
      ? (options?.products ?? []).map((product) => ({
          id: product.id,
          label: `${product.name} — ${formatPrice(product.price)} / ${product.unit}`,
        }))
      : values.destinationType === "CATEGORY"
        ? (options?.categories ?? []).map((category) => ({
            id: category.id,
            label: `${category.name} (${category.productCount} products)`,
          }))
        : values.destinationType === "SHOP"
          ? (options?.shops ?? []).map((shop) => ({
              id: shop.id,
              label: `${shop.name}${shop.city ? ` — ${shop.city}` : ""}`,
            }))
          : [];

  const canSubmit =
    Boolean(values.name.trim()) &&
    Boolean(values.headline.trim()) &&
    !busy;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onAction(values, "publish");
      }}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            {editing ? `Edit “${initial?.name}”` : "Create a campaign"}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Cards appear in the marketplace placement you choose — only when
            the campaign is active.
          </p>
        </div>
        {editing && onCancelEdit ? (
          <button
            type="button"
            onClick={onCancelEdit}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel edit
          </button>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL}>Campaign name (internal)</label>
          <input
            type="text"
            required
            maxLength={120}
            value={values.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="e.g. Mango season — week 30"
            className={INPUT}
          />
        </div>

        <div>
          <label className={LABEL}>Campaign type</label>
          <select
            value={values.type}
            onChange={(event) => changeType(event.target.value as PromoCampaignType)}
            className={INPUT}
          >
            {(Object.keys(TYPE_LABELS) as PromoCampaignType[]).map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <label className={LABEL}>Headline</label>
        <input
          type="text"
          required
          maxLength={160}
          value={values.headline}
          onChange={(event) => patch({ headline: event.target.value })}
          placeholder="e.g. This week’s freshest harvest"
          className={INPUT}
        />
      </div>

      <div className="mt-4">
        <label className={LABEL}>Description (optional)</label>
        <textarea
          rows={2}
          maxLength={500}
          value={values.description}
          onChange={(event) => patch({ description: event.target.value })}
          placeholder="Short supporting line shown on the card."
          className={INPUT}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL}>Call-to-action label</label>
          <input
            type="text"
            maxLength={50}
            value={values.ctaText}
            onChange={(event) => patch({ ctaText: event.target.value })}
            placeholder="View offer"
            className={INPUT}
          />
        </div>

        <div>
          <label className={LABEL}>Display order (priority)</label>
          <input
            type="number"
            value={values.priority}
            onChange={(event) =>
              patch({ priority: Number(event.target.value) || 0 })
            }
            className={INPUT}
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Higher numbers appear first within a placement.
          </p>
        </div>
      </div>

      {/* Placement & layout */}
      <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-4">
        <span className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
          Placement & card format
        </span>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Marketplace placement</label>
            <select
              value={values.placement}
              onChange={(event) =>
                patch({ placement: event.target.value as PromoPlacement })
              }
              className={INPUT}
            >
              {(Object.keys(PLACEMENT_LABELS) as PromoPlacement[]).map(
                (placement) => (
                  <option key={placement} value={placement}>
                    {PLACEMENT_LABELS[placement]}
                  </option>
                ),
              )}
            </select>
          </div>

          <div>
            <label className={LABEL}>Card format</label>
            <select
              value={values.layout}
              onChange={(event) =>
                patch({ layout: event.target.value as PromoCardLayout })
              }
              className={INPUT}
            >
              {(Object.keys(LAYOUT_LABELS) as PromoCardLayout[]).map((layout) => (
                <option key={layout} value={layout}>
                  {LAYOUT_LABELS[layout]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className={LABEL}>Fallback gradient (used when no photo)</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TONE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => patch({ tone: preset.value })}
                className={`flex items-center gap-2 rounded-lg border p-2 text-left text-xs font-medium transition ${
                  values.tone === preset.value
                    ? "border-emerald-600 bg-white shadow-sm ring-2 ring-emerald-500"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <span
                  className={`h-4 w-4 rounded-full bg-gradient-to-br ${preset.value}`}
                />
                <span className="truncate">{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-xs font-medium text-slate-700">
          <input
            type="checkbox"
            checked={values.isSponsored}
            onChange={(event) => patch({ isSponsored: event.target.checked })}
            className="h-4 w-4 rounded text-emerald-700"
          />
          Show a “Sponsored” label on the card
        </label>
      </div>

      {/* Images */}
      <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            Campaign images ({values.images.length}/6)
          </span>
          <span className="text-[11px] text-slate-500">
            Multiple images auto-rotate every ~5s
          </span>
        </div>

        <div className="mt-3">
          <ImageUpload
            kind="promotion"
            value=""
            onChange={(url) => addImage(url)}
          />
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="url"
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder="…or paste an image URL"
            className={INPUT}
          />
          <button
            type="button"
            onClick={() => addImage(imageUrl)}
            disabled={!imageUrl.trim() || values.images.length >= 6}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {values.images.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {values.images.map((image, index) => {
              const preview = buildImageUrl(image.url, 160);
              return (
                <li
                  key={`${image.url}-${index}`}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2"
                >
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-slate-100">
                    {preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-700">
                      {image.url}
                    </div>
                    <input
                      type="text"
                      value={image.alt}
                      maxLength={160}
                      placeholder="Alt text (optional)"
                      onChange={(event) =>
                        patch({
                          images: values.images.map((item, i) =>
                            i === index
                              ? { ...item, alt: event.target.value }
                              : item,
                          ),
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-[11px] outline-none focus:border-emerald-600"
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label="Move image earlier"
                      onClick={() => moveImage(index, -1)}
                      disabled={index === 0}
                      className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ArrowLeftIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move image later"
                      onClick={() => moveImage(index, 1)}
                      disabled={index === values.images.length - 1}
                      className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ArrowRightIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="rounded border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-[11px] text-slate-500">
            No photos yet — the card will use the gradient tone above.
          </p>
        )}
      </div>

      {/* Destination */}
      <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-4">
        <span className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
          Destination
        </span>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Opens</label>
            <select
              value={values.destinationType}
              disabled={
                values.type === "DISCOVER_CATEGORIES" ||
                values.type === "FEATURED_SHOPS"
              }
              onChange={(event) =>
                patch({
                  destinationType: event.target.value as CampaignFormValues["destinationType"],
                  destinationId: "",
                })
              }
              className={INPUT}
            >
              <option value="PRODUCT">A product</option>
              <option value="CATEGORY">A category</option>
              <option value="SHOP">A shop</option>
              <option value="NONE">Nothing (card only)</option>
            </select>
          </div>

          <div>
            <label className={LABEL}>Target</label>
            <select
              value={values.destinationId}
              onChange={(event) => patch({ destinationId: event.target.value })}
              disabled={values.destinationType === "NONE"}
              className={INPUT}
            >
              <option value="">Choose…</option>
              {destinationOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="mt-2 text-[11px] text-slate-500">
          {values.type === "DISCOVER_CATEGORIES"
            ? "Discover campaigns always link to the selected category."
            : values.type === "FEATURED_SHOPS"
              ? "Featured shop campaigns always link to the selected shop."
              : "The CTA falls back to the first visible product when no target is set."}
        </p>
      </div>

      {/* Products */}
      <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            Products ({values.products.length}/12)
          </span>
          <span className="text-[11px] text-slate-500">
            {needsProducts
              ? "Required for this campaign type."
              : "Optional — these products appear inside the card."}
          </span>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="search"
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="Search active products…"
            className={INPUT}
          />
        </div>

        {productMatches.length > 0 ? (
          <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white">
            {productMatches.map((product) => (
              <li
                key={product.id}
                className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 last:border-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-800">
                    {product.name}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">
                    {formatPrice(product.price)} / {product.unit} ·{" "}
                    {product.supplierName}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => addProduct(product.id)}
                  disabled={values.products.length >= 12}
                  className="shrink-0 rounded-lg bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-slate-500">
            No more products match your search.
          </p>
        )}

        {selectedProducts.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {selectedProducts.map(({ link, option }) => (
              <li
                key={link.productId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-2"
              >
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-slate-100">
                  {option?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={buildImageUrl(option.imageUrl, 120) ?? option.imageUrl}
                      alt={option.name}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-slate-800">
                    {option?.name}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Live price {formatPrice(option?.price ?? 0)} / {option?.unit}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-medium text-slate-600">
                    Promo R
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={link.promoPrice}
                      onChange={(event) =>
                        setPromoPrice(link.productId, event.target.value)
                      }
                      placeholder={isOffer ? "required" : "optional"}
                      className="ml-1 w-24 rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-emerald-600"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeProduct(link.productId)}
                    className="rounded border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Schedule & status */}
      <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-4">
        <span className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">
          Schedule & visibility
        </span>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Starts (optional)</label>
            <input
              type="datetime-local"
              value={values.startAt}
              onChange={(event) => patch({ startAt: event.target.value })}
              className={INPUT}
            />
          </div>

          <div>
            <label className={LABEL}>Expires (optional)</label>
            <input
              type="datetime-local"
              value={values.expiresAt}
              onChange={(event) => patch({ expiresAt: event.target.value })}
              className={INPUT}
            />
          </div>
        </div>

        <p className="mt-2 text-[11px] text-slate-500">
          Expired campaigns disappear from the marketplace automatically —
          expiry is enforced by timestamp, not just the status label.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onAction(values, "preview")}
          className="rounded-lg border border-emerald-700 px-4 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save & preview"}
        </button>

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onAction(values, "draft")}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Save draft
        </button>

        <button
          type="button"
          disabled={!canSubmit || !scheduleReady}
          onClick={() => onAction(values, "schedule")}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title={scheduleReady ? undefined : "Set a start date to schedule"}
        >
          Schedule
        </button>

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-emerald-700 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {editing ? "Save & publish" : "Publish"}
        </button>

        {values.status === "PAUSED" && editing ? (
          <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-800">
            Currently paused
          </span>
        ) : null}
      </div>
    </form>
  );
}
