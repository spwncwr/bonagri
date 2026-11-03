"use client";

import { useCallback, useEffect, useState } from "react";
import PromotionForm, {
  LAYOUT_LABELS,
  PLACEMENT_LABELS,
  TYPE_LABELS,
  type AdminCampaign,
  type CampaignFormAction,
  type CampaignFormValues,
  type PromoOptions,
} from "../../../components/admin/promotion-form";
import PromotionCard from "../../../components/promotions/promotion-card";
import { authHeaders } from "../../../lib/auth";
import { AdminRowsSkeleton } from "../../../components/admin/admin-ui";
import type {
  PromoCampaignType,
  PromoPlacement,
  PublicPromotion,
} from "../../../lib/promotions";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type Stats = {
  total: number;
  active: number;
  scheduled: number;
  expired: number;
  paused: number;
  draft: number;
  impressions: number;
  clicks: number;
  clickThroughRate: number;
};

type EffectiveStatus = AdminCampaign["effectiveStatus"];

const STATUS_STYLES: Record<EffectiveStatus, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  SCHEDULED: "bg-sky-100 text-sky-800",
  PAUSED: "bg-amber-100 text-amber-800",
  EXPIRED: "bg-slate-200 text-slate-600",
  DRAFT: "bg-slate-100 text-slate-600",
};

const STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "PAUSED", label: "Paused" },
  { value: "EXPIRED", label: "Expired" },
  { value: "DRAFT", label: "Draft" },
];

const PLACEMENT_OPTIONS = [
  { value: "", label: "All placements" },
  ...(Object.keys(PLACEMENT_LABELS) as PromoPlacement[]).map((placement) => ({
    value: placement,
    label: PLACEMENT_LABELS[placement],
  })),
];

function toPayload(
  values: CampaignFormValues,
  status: CampaignFormValues["status"],
) {
  return {
    name: values.name.trim(),
    headline: values.headline.trim(),
    description: values.description.trim() || null,
    type: values.type,
    status,
    layout: values.layout,
    placement: values.placement,
    priority: values.priority,
    ctaText: values.ctaText.trim() || "View offer",
    tone: values.tone,
    isSponsored: values.isSponsored,
    startAt: values.startAt ? new Date(values.startAt).toISOString() : null,
    expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
    destinationType: values.destinationType,
    destinationId: values.destinationId || null,
    images: values.images.map((image) => ({
      url: image.url,
      alt: image.alt.trim() || undefined,
    })),
    products: values.products.map((product) => ({
      productId: product.productId,
      promoPrice: product.promoPrice.trim()
        ? Number(product.promoPrice)
        : null,
    })),
  };
}

function formatNumber(value: number) {
  return value.toLocaleString("en-ZA");
}

function formatWindow(campaign: AdminCampaign) {
  const format = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("en-ZA", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null;

  const start = format(campaign.startAt);
  const end = format(campaign.expiresAt);

  if (start && end) return `${start} → ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return "No schedule";
}

export default function AdminPromotionsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [options, setOptions] = useState<PromoOptions | null>(null);
  const [campaigns, setCampaigns] = useState<AdminCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [placementFilter, setPlacementFilter] = useState("");

  const [editing, setEditing] = useState<AdminCampaign | null>(null);
  const [formKey, setFormKey] = useState("new");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const [preview, setPreview] = useState<PublicPromotion | null>(null);
  const [previewLabel, setPreviewLabel] = useState("");
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const loadCampaigns = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (statusFilter && statusFilter !== "ALL") params.set("status", statusFilter);
    if (placementFilter) params.set("placement", placementFilter);

    const response = await fetch(
      `${API_BASE_URL}/api/admin/promotions${params.size ? `?${params.toString()}` : ""}`,
      { headers: authHeaders(), cache: "no-store" },
    );
    if (!response.ok) throw new Error("Unable to load campaigns");
    setCampaigns((await response.json()) as AdminCampaign[]);
  }, [search, statusFilter, placementFilter]);

  const loadStats = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/api/admin/promotions/stats`, {
      headers: authHeaders(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Unable to load campaign stats");
    setStats((await response.json()) as Stats);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [statsResponse, optionsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/admin/promotions/stats`, {
            headers: authHeaders(),
            cache: "no-store",
          }),
          fetch(`${API_BASE_URL}/api/admin/promotions/options`, {
            headers: authHeaders(),
            cache: "no-store",
          }),
        ]);

        if (cancelled) return;
        if (!statsResponse.ok) throw new Error("Unable to load campaign stats");
        if (!optionsResponse.ok) {
          throw new Error("Unable to load products and shops");
        }

        setStats((await statsResponse.json()) as Stats);
        setOptions((await optionsResponse.json()) as PromoOptions);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load promotion settings",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(() => {
      setLoading(true);
      setListError("");

      loadCampaigns()
        .catch((loadError) => {
          if (!cancelled) {
            setListError(
              loadError instanceof Error
                ? loadError.message
                : "Unable to load campaigns",
            );
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadCampaigns]);

  async function refresh() {
    try {
      await Promise.all([loadCampaigns(), loadStats()]);
    } catch {
      // The last successful data stays visible.
    }
  }

  async function showPreview(campaign: AdminCampaign) {
    setPreviewLabel(campaign.name);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/admin/promotions/${campaign.id}/preview`,
        { headers: authHeaders(), cache: "no-store" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || "Preview is not available yet");
      }
      setPreview((await response.json()) as PublicPromotion);
    } catch (previewError) {
      setPreview(null);
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Preview is not available yet",
      );
    }
  }

  async function handleFormAction(
    values: CampaignFormValues,
    action: CampaignFormAction,
  ) {
    setFormBusy(true);
    setFormError("");
    setError("");
    setSuccess("");

    const status: CampaignFormValues["status"] =
      action === "draft"
        ? "DRAFT"
        : action === "schedule"
          ? "SCHEDULED"
          : action === "publish"
            ? "ACTIVE"
            : (editing?.status ?? "DRAFT");

    try {
      const response = await fetch(
        editing
          ? `${API_BASE_URL}/api/admin/promotions/${editing.id}`
          : `${API_BASE_URL}/api/admin/promotions`,
        {
          method: editing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify(toPayload(values, status)),
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          Array.isArray(data?.message)
            ? data.message.join(", ")
            : data?.message || "Unable to save the campaign",
        );
      }

      const saved = (await response.json()) as AdminCampaign;
      setSuccess(
        action === "preview"
          ? "Draft saved — previewing below."
          : `${saved.name} saved as ${saved.effectiveStatus.toLowerCase()}.`,
      );

      if (action === "preview") {
        setEditing(saved);
        setFormKey(saved.id);
        await showPreview(saved);
      } else {
        setEditing(null);
        setFormKey(`new-${Date.now()}`);
        setPreview(null);
      }

      await refresh();
    } catch (saveError) {
      setFormError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save the campaign",
      );
    } finally {
      setFormBusy(false);
    }
  }

  async function lifecycle(campaign: AdminCampaign, action: "publish" | "pause" | "resume") {
    setActionBusyId(campaign.id);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/admin/promotions/${campaign.id}/${action}`,
        { method: "POST", headers: authHeaders() },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || `Unable to ${action} the campaign`);
      }

      setSuccess(
        `${campaign.name} ${
          action === "publish" ? "published" : action === "pause" ? "paused" : "resumed"
        }.`,
      );

      if (editing?.id === campaign.id) {
        const updated = (await response.json()) as AdminCampaign;
        setEditing(updated);
        setFormKey(`${updated.id}-${updated.updatedAt}`);
      }

      await refresh();
    } catch (lifecycleError) {
      setError(
        lifecycleError instanceof Error
          ? lifecycleError.message
          : `Unable to ${action} the campaign`,
      );
    } finally {
      setActionBusyId(null);
    }
  }

  async function remove(campaign: AdminCampaign) {
    if (
      !confirm(
        `Delete “${campaign.name}”? Its analytics history will be removed too.`,
      )
    ) {
      return;
    }

    setActionBusyId(campaign.id);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/admin/promotions/${campaign.id}`,
        { method: "DELETE", headers: authHeaders() },
      );
      if (!response.ok) throw new Error("Unable to delete the campaign");

      if (editing?.id === campaign.id) {
        setEditing(null);
        setFormKey(`new-${Date.now()}`);
      }
      setSuccess(`${campaign.name} deleted.`);
      await refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete the campaign",
      );
    } finally {
      setActionBusyId(null);
    }
  }

  function startEdit(campaign: AdminCampaign) {
    setEditing(campaign);
    setFormKey(campaign.id);
    setFormError("");
    setPreview(null);
    window.setTimeout(() => {
      document
        .getElementById("promotion-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }

  const statCards: Array<{ label: string; value: string; hint?: string }> = [
    { label: "Total campaigns", value: stats ? formatNumber(stats.total) : "—" },
    { label: "Active", value: stats ? formatNumber(stats.active) : "—" },
    { label: "Scheduled", value: stats ? formatNumber(stats.scheduled) : "—" },
    { label: "Paused", value: stats ? formatNumber(stats.paused) : "—" },
    { label: "Expired", value: stats ? formatNumber(stats.expired) : "—" },
    {
      label: "Impressions",
      value: stats ? formatNumber(stats.impressions) : "—",
    },
    { label: "Clicks", value: stats ? formatNumber(stats.clicks) : "—" },
    {
      label: "Click-through rate",
      value: stats ? `${stats.clickThroughRate}%` : "—",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Marketplace Promotions
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Campaigns render inside the live marketplace feed at the placement
          you choose. Prices, stock and product availability are resolved from
          the real catalog every time a card is requested.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          {success}
        </div>
      ) : null}

      <section aria-label="Campaign overview">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {statCards.map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {card.label}
              </div>
              <div className="mt-1 text-xl font-black tracking-tight text-slate-900">
                {card.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div id="promotion-form">
        <PromotionForm
          key={formKey}
          options={options}
          initial={editing}
          busy={formBusy}
          error={formError}
          onAction={(values, action) => void handleFormAction(values, action)}
          onCancelEdit={() => {
            setEditing(null);
            setFormKey(`new-${Date.now()}`);
            setFormError("");
          }}
        />
      </div>

      {preview ? (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-8"
          role="dialog"
          aria-modal="true"
          aria-label="Campaign preview"
          onClick={() => setPreview(null)}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-[#f7f6f0] p-4 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#17633a]">
                  Marketplace preview
                </div>
                <div className="text-sm font-bold text-slate-900">
                  {previewLabel}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <PromotionCard promotion={preview} preview />
            <p className="mt-3 text-center text-[11px] text-slate-500">
              Preview uses the live catalog — scheduled or paused campaigns
              cannot appear publicly.
            </p>
          </div>
        </div>
      ) : null}

      <section aria-label="Campaigns">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">
            Campaigns ({campaigns.length})
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or headline…"
              className="w-52 rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={placementFilter}
              onChange={(event) => setPlacementFilter(event.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            >
              {PLACEMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {listError ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {listError}
          </div>
        ) : null}

        {loading ? (
          <AdminRowsSkeleton className="mt-4" rows={3} label="Loading campaigns…" rowHeight="h-28" />
        ) : campaigns.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            No campaigns match these filters. The marketplace feed works normally
            without promotions.
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {campaigns.map((campaign) => {
              const busy = actionBusyId === campaign.id;
              const thumbnail =
                campaign.images[0]?.url ?? campaign.products[0]?.product.imageUrl ?? null;
              const maxDiscount = campaign.products.reduce((max, link) => {
                if (link.promoPrice === null) return max;
                const live = Number(link.product.price);
                if (live <= 0) return max;
                return Math.max(
                  max,
                  Math.round(((live - link.promoPrice) / live) * 100),
                );
              }, 0);

              return (
                <li
                  key={campaign.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 flex-1 items-start gap-4">
                      <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                        {thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumbnail}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[9px] font-bold uppercase text-slate-400">
                            No photo
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${STATUS_STYLES[campaign.effectiveStatus]}`}
                          >
                            {campaign.effectiveStatus}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                            {TYPE_LABELS[campaign.type as PromoCampaignType]}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {PLACEMENT_LABELS[campaign.placement]} ·{" "}
                            {LAYOUT_LABELS[campaign.layout]} · priority{" "}
                            {campaign.priority}
                          </span>
                          {campaign.isSponsored ? (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                              Sponsored
                            </span>
                          ) : null}
                        </div>

                        <h3 className="mt-1 truncate text-sm font-bold text-slate-900">
                          {campaign.name}
                        </h3>
                        <p className="truncate text-xs text-slate-600">
                          {campaign.headline}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                          <span>{formatWindow(campaign)}</span>
                          <span>
                            {campaign.products.length} product
                            {campaign.products.length === 1 ? "" : "s"}
                            {maxDiscount > 0 ? ` · up to ${maxDiscount}% off` : ""}
                          </span>
                          <span>
                            {formatNumber(campaign.impressions)} impressions ·{" "}
                            {formatNumber(campaign.clicks)} clicks ·{" "}
                            {campaign.clickThroughRate}% CTR
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void showPreview(campaign)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(campaign)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>

                      {campaign.effectiveStatus === "DRAFT" ||
                      campaign.effectiveStatus === "EXPIRED" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void lifecycle(campaign, "publish")}
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          Publish
                        </button>
                      ) : null}

                      {campaign.effectiveStatus === "ACTIVE" ||
                      campaign.effectiveStatus === "SCHEDULED" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void lifecycle(campaign, "pause")}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                        >
                          Pause
                        </button>
                      ) : null}

                      {campaign.effectiveStatus === "PAUSED" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void lifecycle(campaign, "resume")}
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          Resume
                        </button>
                      ) : null}

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(campaign)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
