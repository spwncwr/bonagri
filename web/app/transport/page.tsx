"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "../../components/auth/auth-guard";
import { AppearanceSection } from "../../components/theme/theme-switch";
import { BrandIcon } from "../../components/brand/logo";
import LocationTracking from "../../components/transport/location-tracking";
import TransporterSettings from "../../components/transport/transporter-settings";
import {
  ArrowRightIcon,
  BellIcon,
  BoxIcon,
  CallIcon,
  CheckIcon,
  CloseIcon,
  HomeIcon,
  LogoutIcon,
  MapPinIcon,
  TruckIcon,
  UserIcon,
} from "../../components/mobile/icons";
import { authHeaders, clearAuth } from "../../lib/auth";
import type { Delivery, Job } from "../../lib/transport";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

/* ═══════════════════════════════════════════════════════════════════════════
   Constants & Helpers
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  DeskSection,
  FilterBar,
  JobCard,
  ProgressStepper,
  RoutePanel,
  StatCard,
  TrackingCard,
  TransportHeader,
  TransportRail,
  formatDate,
  itemSummary,
  STATUS_CHIP,
  STATUS_TONE,
  type PeriodFilter,
  type StatusFilter,
  type TransportView,
} from "../../components/transport/transport-panels";

/* ═══════════════════════════════════════════════════════════════════════════
   Delivery filters (desktop list only; the phone shell shows everything)
   ═══════════════════════════════════════════════════════════════════════════ */

function matchesQuery(delivery: Delivery, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    delivery.order.orderNumber,
    delivery.order.user.firstName,
    delivery.order.user.lastName,
    delivery.order.deliveryAddress.city,
    delivery.order.deliveryAddress.province ?? "",
    delivery.order.deliveryAddress.recipientName,
    delivery.order.items[0]?.product.supplier?.city ?? "",
    ...delivery.order.items.map((item) => item.product.name),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

function matchesPeriod(delivery: Delivery, period: PeriodFilter): boolean {
  if (period === "ALL") return true;
  const at =
    delivery.deliveredAt ??
    delivery.failedAt ??
    delivery.pickedUpAt ??
    delivery.order.createdAt;
  const days = Number(period);
  return Date.now() - new Date(at).getTime() <= days * 86_400_000;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Tab Bar (with elevated centre refresh button)
   ═══════════════════════════════════════════════════════════════════════════ */

function TabBtn({
  label,
  Icon,
  badge,
  active,
  onTap,
}: {
  label: string;
  Icon: typeof HomeIcon;
  badge: number;
  active: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      aria-current={active ? "page" : undefined}
      className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-black uppercase tracking-wide transition ${
        active ? "text-[#17633a]" : "text-[#8a948b]"
      }`}
    >
      <span className="relative">
        <Icon className="h-[22px] w-[22px]" />
        {badge > 0 && (
          <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#17633a] px-1 text-[9px] font-black not-italic text-white">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>
      {label}
    </button>
  );
}

function TransportTabBar({
  view,
  onNavigate,
  onRefresh,
  jobCount,
  activeCount,
}: {
  view: TransportView;
  onNavigate: (v: TransportView) => void;
  onRefresh: () => void;
  jobCount: number;
  activeCount: number;
}) {
  return (
    <nav
      aria-label="Transport navigation"
      className="fixed inset-x-0 bottom-0 z-40 rounded-t-3xl bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.06)]"
    >
      <div className="mx-auto flex max-w-md items-end justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        <TabBtn
          label="Home"
          Icon={HomeIcon}
          badge={0}
          active={view === "home"}
          onTap={() => onNavigate("home")}
        />
        <TabBtn
          label="Jobs"
          Icon={BoxIcon}
          badge={jobCount}
          active={view === "jobs"}
          onTap={() => onNavigate("jobs")}
        />

        {/* Elevated centre refresh button */}
        <div className="relative flex w-14 items-center justify-center">
          <button
            type="button"
            onClick={onRefresh}
            className="absolute -top-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#17633a] text-white shadow-lg shadow-[#17633a]/25 transition active:scale-95"
            aria-label="Refresh data"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>

        <TabBtn
          label="Tracking"
          Icon={TruckIcon}
          badge={activeCount}
          active={view === "deliveries"}
          onTap={() => onNavigate("deliveries")}
        />
        <TabBtn
          label="Profile"
          Icon={UserIcon}
          badge={0}
          active={view === "profile"}
          onTap={() => onNavigate("profile")}
        />
      </div>
    </nav>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Delivery Detail Sheet (slide-up bottom sheet)
   ═══════════════════════════════════════════════════════════════════════════ */

function DetailSheet({
  delivery,
  busy,
  onAction,
  onFail,
  onTrack,
  onClose,
}: {
  delivery: Delivery;
  busy: boolean;
  onAction: (d: Delivery, a: "pickup" | "transit" | "complete") => void;
  onFail: (d: Delivery) => void;
  onTrack: (d: Delivery) => void;
  onClose: () => void;
}) {
  const chip = STATUS_CHIP[delivery.status];
  const addr = delivery.order.deliveryAddress;
  const buyer = delivery.order.user;
  const totalQty = delivery.order.items.reduce(
    (sum, i) => sum + i.quantity,
    0,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-0 sm:px-4">
      {/* Backdrop tap to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Sheet */}
      <div className="relative z-10 w-full max-w-md animate-[slideUp_0.3s_ease-out] rounded-t-3xl bg-slate-900 px-5 pb-8 pt-4 text-white">
        {/* Handle bar */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-600" />

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-slate-400 transition hover:text-white"
          aria-label="Close"
        >
          <CloseIcon className="h-5 w-5" />
        </button>

        {/* Order ID + Status */}
        <div className="flex items-start justify-between pr-8">
          <div>
            <div className="text-[11px] font-semibold text-slate-400">
              Order #
            </div>
            <div className="text-lg font-black tracking-tight">
              {delivery.order.orderNumber}
            </div>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-black ${chip.cls}`}
          >
            {chip.label}
          </span>
        </div>

        {/* Progress stepper */}
        <div className="mt-5">
          <ProgressStepper status={delivery.status} showLabels />
        </div>

        {/* Dates row */}
        <div className="mt-6 flex justify-between text-xs">
          <div>
            <div className="font-semibold text-slate-400">Created</div>
            <div className="mt-0.5 font-bold">
              {formatDate(delivery.order.createdAt)}
            </div>
          </div>
          <div className="text-right">
            <div className="font-semibold text-slate-400">Last Update</div>
            <div className="mt-0.5 font-bold">
              {formatDate(
                delivery.deliveredAt ??
                  delivery.failedAt ??
                  delivery.pickedUpAt ??
                  delivery.order.createdAt,
              )}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="my-4 border-t border-slate-700" />

        {/* From / To */}
        <div className="flex justify-between text-xs">
          <div>
            <div className="font-semibold text-slate-400">From</div>
            <div className="mt-0.5 font-bold">
              {addr.city || "Pickup TBC"}
            </div>
          </div>
          <div className="text-right">
            <div className="font-semibold text-slate-400">To</div>
            <div className="mt-0.5 font-bold">
              {addr.city}
              {addr.province ? `, ${addr.province}` : ""}
            </div>
          </div>
        </div>

        {/* Customer / Items */}
        <div className="mt-4 flex justify-between text-xs">
          <div>
            <div className="font-semibold text-slate-400">Customer</div>
            <div className="mt-0.5 font-bold">
              {buyer.firstName} {buyer.lastName}
            </div>
          </div>
          <div className="text-right">
            <div className="font-semibold text-slate-400">Items</div>
            <div className="mt-0.5 font-bold">
              {totalQty} item{totalQty === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        {/* Delivery address */}
        <div className="mt-4 text-xs">
          <div className="font-semibold text-slate-400">Delivery Address</div>
          <div className="mt-0.5 font-bold">
            {addr.recipientName} — {addr.addressLine1}, {addr.city}
          </div>
        </div>

        {/* Keyless hand-off to the device's navigation app — the confirmed
            pin when the address has one, the readable address otherwise. */}
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
            addr.lat != null && addr.lng != null
              ? `${addr.lat},${addr.lng}`
              : [addr.addressLine1, addr.city, addr.province]
                  .filter(Boolean)
                  .join(", "),
          )}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-800"
        >
          <MapPinIcon className="h-4 w-4" />
          Open in Maps
        </a>

        {/* Goods list */}
        <div className="mt-4 text-xs">
          <div className="font-semibold text-slate-400">Goods</div>
          <ul className="mt-1 space-y-0.5">
            {delivery.order.items.map((item, idx) => (
              <li key={idx} className="font-bold">
                {item.quantity}× {item.product.name}
              </li>
            ))}
          </ul>
        </div>

        {/* Failed reason */}
        {delivery.status === "FAILED" && delivery.failedReason && (
          <div className="mt-4 rounded-xl bg-red-900/40 px-3 py-2 text-xs font-bold text-red-300">
            Failure: {delivery.failedReason}
          </div>
        )}

        {/* Buyer contact row */}
        {buyer.phone && (
          <div className="mt-5 flex items-center justify-between rounded-2xl bg-slate-800 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700">
                <UserIcon className="h-5 w-5 text-slate-300" />
              </div>
              <div>
                <div className="text-sm font-bold">
                  {buyer.firstName} {buyer.lastName}
                </div>
                <div className="text-[11px] text-slate-400">Buyer</div>
              </div>
            </div>
            <a
              href={`tel:${buyer.phone}`}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#17633a] text-white transition hover:bg-[#0f4d2b]"
              aria-label="Call buyer"
            >
              <CallIcon className="h-5 w-5" />
            </a>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-5 flex flex-wrap gap-2">
          {delivery.status === "ASSIGNED" && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction(delivery, "pickup")}
                className="flex-1 rounded-xl bg-[#17633a] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#0f4d2b] disabled:opacity-50"
              >
                {busy ? "Saving..." : "Confirm Pickup"}
              </button>
              <button
                type="button"
                onClick={() => onFail(delivery)}
                className="rounded-xl border border-red-400/30 px-4 py-3 text-sm font-bold text-red-400 transition hover:bg-red-900/20"
              >
                Report Failure
              </button>
            </>
          )}

          {delivery.status === "PICKED_UP" && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction(delivery, "transit")}
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? "Saving..." : "Start Transit"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction(delivery, "complete")}
                className="flex-1 rounded-xl bg-[#17633a] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#0f4d2b] disabled:opacity-50"
              >
                Mark Delivered
              </button>
              <button
                type="button"
                onClick={() => onFail(delivery)}
                className="w-full rounded-xl border border-red-400/30 px-4 py-3 text-sm font-bold text-red-400 transition hover:bg-red-900/20"
              >
                Report Failure
              </button>
            </>
          )}

          {delivery.status === "IN_TRANSIT" && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction(delivery, "complete")}
                className="flex-1 rounded-xl bg-[#17633a] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#0f4d2b] disabled:opacity-50"
              >
                {busy ? "Saving..." : "Mark Delivered"}
              </button>
              <button
                type="button"
                onClick={() => onFail(delivery)}
                className="rounded-xl border border-red-400/30 px-4 py-3 text-sm font-bold text-red-400 transition hover:bg-red-900/20"
              >
                Report Failure
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => onTrack(delivery)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 py-3 text-sm font-bold text-slate-200 transition hover:bg-slate-800"
        >
          <MapPinIcon className="h-4 w-4" />
          Live tracking map
        </button>
      </div>

      {/* Slide-up animation */}
      <style jsx>{`
        @keyframes slideUp {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Transport Hub
   ═══════════════════════════════════════════════════════════════════════════ */

function TransportHub() {
  const router = useRouter();
  const [tab, setTab] = useState<TransportView>("home");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [active, setActive] = useState<Delivery[]>([]);
  const [history, setHistory] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [unverified, setUnverified] = useState(false);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [failTarget, setFailTarget] = useState<Delivery | null>(null);
  const [failReason, setFailReason] = useState("");
  const [failing, setFailing] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(
    null,
  );
  const [trackedDelivery, setTrackedDelivery] = useState<Delivery | null>(null);
  // Desk-only list filters and the delivery the route panel is plotting.
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("ALL");
  const [focusedId, setFocusedId] = useState<string | null>(null);

  /* ── API calls ────────────────────────────────────────────────────────── */

  const loadBoard = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/api/transport/jobs`, {
      cache: "no-store",
      headers: authHeaders(),
    });

    if (response.status === 403) {
      setUnverified(true);
      setJobs([]);
      return;
    }

    if (!response.ok) {
      throw new Error("Could not load the delivery board");
    }

    setUnverified(false);
    setJobs((await response.json()) as Job[]);
  }, []);

  const loadDeliveries = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/api/transport/deliveries`, {
      cache: "no-store",
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error("Could not load your deliveries");
    }

    const data = (await response.json()) as {
      active: Delivery[];
      history: Delivery[];
    };

    setActive(data.active);
    setHistory(data.history);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadBoard(), loadDeliveries()]);
  }, [loadBoard, loadDeliveries]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await refreshAll();
      } catch (err) {
        if (!cancelled) {
          setPageError(
            err instanceof Error ? err.message : "Something went wrong",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshAll]);

  /* ── Action handlers ──────────────────────────────────────────────────── */

  async function claimJob(job: Job) {
    setClaimingId(job.orderId);
    setNotice("");
    setPageError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/transport/jobs/${job.orderId}/claim`,
        { method: "POST", headers: authHeaders() },
      );

      if (response.status === 409) {
        setNotice(
          `Order ${job.orderNumber} was just claimed by another transporter.`,
        );
        await refreshAll();
        return;
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? "Could not claim this job");
      }

      setNotice(
        `You claimed order ${job.orderNumber}. Check the Tracking tab for details.`,
      );
      await refreshAll();
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Could not claim this job",
      );
    } finally {
      setClaimingId(null);
    }
  }

  async function deliveryAction(
    delivery: Delivery,
    action: "pickup" | "transit" | "complete",
  ) {
    setActingId(delivery.orderId);
    setNotice("");
    setPageError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders/${delivery.orderId}/delivery/${action}`,
        { method: "PATCH", headers: authHeaders() },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? "Could not update the delivery");
      }

      const labels = {
        pickup: "Pickup confirmed — the buyer has been notified.",
        transit: "Delivery marked in transit.",
        complete: "Delivery completed. Thank you!",
      };
      setNotice(labels[action]);
      setSelectedDelivery(null);
      await refreshAll();
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Could not update the delivery",
      );
    } finally {
      setActingId(null);
    }
  }

  async function submitFailure(event: React.FormEvent) {
    if (!failTarget) return;
    event.preventDefault();

    if (failReason.trim().length < 3) {
      setPageError("Please give a short reason (at least 3 characters).");
      return;
    }

    setFailing(true);
    setPageError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders/${failTarget.orderId}/delivery/fail`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ reason: failReason.trim() }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? "Could not record the failure");
      }

      setNotice(
        `Failure recorded for ${failTarget.order.orderNumber}. The supplier has been asked to re-dispatch.`,
      );
      setFailTarget(null);
      setFailReason("");
      setSelectedDelivery(null);
      await refreshAll();
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Could not record the failure",
      );
    } finally {
      setFailing(false);
    }
  }

  function handleRefresh() {
    setLoading(true);
    setPageError("");
    void refreshAll()
      .catch((err) =>
        setPageError(
          err instanceof Error ? err.message : "Refresh failed",
        ),
      )
      .finally(() => setLoading(false));
  }

  function signOut() {
    clearAuth();
    router.push("/login");
  }

  /* ── Featured delivery (first active) for the Home tab ────────────────── */
  const featured = active.length > 0 ? active[0] : null;

  /* ── Desk derivations (client-side over the same loaded rows) ─────────── */
  const needle = query.trim().toLowerCase();
  const deskMatches = (delivery: Delivery) =>
    (statusFilter === "ALL" || delivery.status === statusFilter) &&
    matchesPeriod(delivery, periodFilter) &&
    matchesQuery(delivery, needle);

  const deskActive = active.filter(deskMatches);
  const deskHistory = history.filter(deskMatches);

  const deskFocused =
    active.find((delivery) => delivery.orderId === focusedId) ?? featured;

  const completedCount = history.filter(
    (delivery) => delivery.status === "DELIVERED",
  ).length;
  const failedCount = history.filter(
    (delivery) => delivery.status === "FAILED",
  ).length;

  const openDesk = (delivery: Delivery) => {
    setFocusedId(delivery.orderId);
    setSelectedDelivery(delivery);
  };

  const deskCopy: Record<TransportView, { title: string; subtitle: string }> = {
    home: {
      title: "Transport desk",
      subtitle: "Jobs, deliveries and routes in one widescreen view",
    },
    jobs: {
      title: "Open jobs",
      subtitle: "Deliveries published in the provinces you serve",
    },
    deliveries: {
      title: "My deliveries",
      subtitle: "Status of every job you have claimed",
    },
    profile: {
      title: "Profile",
      subtitle: "Your transporter account and appearance",
    },
  };

  /* ═══════════════════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════════════════ */

  return (
    <main className="min-h-screen bg-[#f7f6f0] lg:bg-page">
      {/* ── Decorative background shape (similar to buyer homescreen) ───── */}
      <div
        className="pointer-events-none fixed left-[-30%] top-[-15%] z-0 h-[55vw] w-[75vw] max-h-[420px] max-w-[580px] rotate-45 rounded-[60px] opacity-[0.08] lg:hidden"
        style={{ background: "linear-gradient(135deg, #17633a 0%, #2d9d5e 100%)" }}
      />

      {/* Desktop widescreen composition: icon rail beside the desk column.
          Below lg this wrapper is an unstyled block, so the phone shell
          renders exactly as before. */}
      <div className="mx-auto w-full max-w-[1700px] lg:flex">
        <TransportRail
          view={tab}
          onNavigate={setTab}
          jobCount={jobs.length}
          activeCount={active.length}
          onSignOut={signOut}
        />

        <div className="min-w-0 flex-1">
          <TransportHeader
            title={deskCopy[tab].title}
            subtitle={deskCopy[tab].subtitle}
            busy={loading}
            onRefresh={handleRefresh}
            onSignOut={signOut}
          />

          {/* ── Content wrapper ───────────────────────────────────────────── */}
          <div className="relative z-10 mx-auto max-w-md min-h-screen px-4 pb-28 lg:max-w-none lg:px-6 lg:pb-12">
        {/* ── Toast notices ──────────────────────────────────────────────── */}
        {notice && (
          <div className="fixed left-1/2 top-4 z-50 w-[90%] max-w-sm -translate-x-1/2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800 shadow-lg">
            {notice}
            <button
              type="button"
              onClick={() => setNotice("")}
              className="absolute right-2 top-2 text-emerald-600"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        )}
        {pageError && (
          <div className="fixed left-1/2 top-4 z-50 w-[90%] max-w-sm -translate-x-1/2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-700 shadow-lg">
            {pageError}
            <button
              type="button"
              onClick={() => setPageError("")}
              className="absolute right-2 top-2 text-red-500"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
           HOME TAB
           ════════════════════════════════════════════════════════════════ */}
        {tab === "home" && (
          <div className="lg:hidden">
            {/* Header */}
            <header className="flex items-center justify-between pb-2 pt-6">
              <div>
                <Link
                  href="/"
                  className="flex items-center gap-2"
                >
                  <BrandIcon size={36} className="rounded-xl" />
                  <div>
                    <div className="text-lg font-black tracking-tight">
                      BonAgri
                    </div>
                    <div className="text-[8px] font-bold uppercase tracking-[0.25em] text-[#778178]">
                      Transport Hub
                    </div>
                  </div>
                </Link>
              </div>
              <button
                type="button"
                className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm"
                aria-label="Notifications"
              >
                <BellIcon className="h-5 w-5 text-[#2c3a2f]" />
                {(jobs.length > 0 || active.length > 0) && (
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#17633a]" />
                )}
              </button>
            </header>

            {/* Loading state */}
            {loading && (
              <div className="mt-16 flex flex-col items-center gap-3 text-sm font-bold text-[#637067]">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#ccd5ca] border-t-[#17633a]" />
                Loading your transport hub...
              </div>
            )}

            {/* Unverified banner */}
            {!loading && unverified && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <h2 className="font-black text-amber-900">
                  Profile being verified
                </h2>
                <p className="mt-2 text-sm leading-6 text-amber-800">
                  The BonAgri team verifies transporter profiles before jobs
                  become visible. You will be notified once verified.
                </p>
              </div>
            )}

            {!loading && !unverified && (
              <>
                {/* Action cards (like "New Delivery" / "Track Package" in ref) */}
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTab("jobs")}
                    className="group relative overflow-hidden rounded-2xl bg-white p-4 text-left shadow-sm transition active:scale-[0.98]"
                  >
                    <div className="text-sm font-black text-[#2c3a2f]">
                      Open Jobs
                    </div>
                    <div className="mt-0.5 text-xs text-[#637067]">
                      Browse &amp; claim
                    </div>
                    <div className="mt-2 text-2xl font-black text-[#17633a]">
                      {jobs.length}
                    </div>
                    <div className="absolute -bottom-2 -right-2 opacity-10">
                      <BoxIcon className="h-16 w-16 text-[#17633a]" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTab("deliveries")}
                    className="group relative overflow-hidden rounded-2xl bg-white p-4 text-left shadow-sm transition active:scale-[0.98]"
                  >
                    <div className="text-sm font-black text-[#2c3a2f]">
                      My Deliveries
                    </div>
                    <div className="mt-0.5 text-xs text-[#637067]">
                      Track progress
                    </div>
                    <div className="mt-2 text-2xl font-black text-[#17633a]">
                      {active.length}
                    </div>
                    <div className="absolute -bottom-2 -right-2 opacity-10">
                      <TruckIcon className="h-16 w-16 text-[#17633a]" />
                    </div>
                  </button>
                </div>

                {/* Current Delivery — featured card */}
                <section className="mt-6">
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-base font-black text-[#2c3a2f]">
                      Current Delivery
                    </h2>
                    {active.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setTab("deliveries")}
                        className="text-xs font-bold text-[#17633a]"
                      >
                        See All
                      </button>
                    )}
                  </div>

                  {featured ? (
                    <div className="mt-3 overflow-hidden rounded-2xl bg-white shadow-sm">
                      <button
                        type="button"
                        onClick={() => setSelectedDelivery(featured)}
                        className="w-full p-4 text-left transition active:bg-[#f8faf6]"
                      >
                      {/* Top row: icon + ID + status */}
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f2f4ef]">
                          <BoxIcon className="h-6 w-6 text-[#17633a]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-black text-[#2c3a2f]">
                            {featured.order.orderNumber}
                          </div>
                          <div className="truncate text-xs text-[#637067]">
                            {itemSummary(featured.order.items)}
                          </div>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-black ${STATUS_CHIP[featured.status].cls}`}
                        >
                          {STATUS_CHIP[featured.status].label}
                        </span>
                      </div>

                      {/* Progress stepper */}
                      <div className="mt-4 px-1">
                        <ProgressStepper status={featured.status} />
                      </div>

                      {/* Date + Route row */}
                      <div className="mt-4 flex items-center justify-between text-xs">
                        <div>
                          <div className="text-[10px] font-semibold text-[#8a948b]">
                            {formatDate(featured.order.createdAt)}
                          </div>
                          <div className="mt-0.5 font-bold text-[#2c3a2f]">
                            {featured.order.deliveryAddress.city || "Pickup"}
                          </div>
                        </div>
                        <ArrowRightIcon
                          className="h-4 w-4 text-[#17633a]"
                          strokeWidth={2.2}
                        />
                        <div className="text-right">
                          <div className="text-[10px] font-semibold text-[#8a948b]">
                            {formatDate(
                              featured.deliveredAt ??
                                featured.pickedUpAt ??
                                featured.order.createdAt,
                            )}
                          </div>
                          <div className="mt-0.5 font-bold text-[#2c3a2f]">
                            {featured.order.deliveryAddress.city}
                            {featured.order.deliveryAddress.province
                              ? `, ${featured.order.deliveryAddress.province}`
                              : ""}
                          </div>
                        </div>
                      </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTrackedDelivery(featured)}
                        className="flex w-full items-center justify-center gap-2 border-t border-[#eef1ea] bg-[#f7faf5] px-4 py-3 text-xs font-black text-[#17633a] transition active:bg-[#eef4e9]"
                      >
                        <MapPinIcon className="h-4 w-4" />
                        Track live on map
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-dashed border-[#ccd5ca] bg-white/60 p-6 text-center text-sm text-[#637067]">
                      No active delivery. Claim a job to get started!
                    </div>
                  )}
                </section>

                {/* Recent Deliveries */}
                {history.length > 0 && (
                  <section className="mt-6">
                    <div className="flex items-baseline justify-between">
                      <h2 className="text-base font-black text-[#2c3a2f]">
                        Recent Deliveries
                      </h2>
                      <span className="text-xs font-bold text-[#8a948b]">
                        {history.length} total
                      </span>
                    </div>

                    <div className="mt-3 space-y-2">
                      {history.slice(0, 3).map((d) => {
                        const chip = STATUS_CHIP[d.status];
                        return (
                          <div
                            key={d.orderId}
                            className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm"
                          >
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#f2f4ef]">
                              <BoxIcon className="h-5 w-5 text-[#8a948b]" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-black text-[#2c3a2f]">
                                {d.order.orderNumber}
                              </div>
                              <div className="truncate text-xs text-[#637067]">
                                {itemSummary(d.order.items)}
                              </div>
                            </div>
                            <span
                              className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${chip.cls}`}
                            >
                              {chip.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
           JOBS TAB (Claim Board)
           ════════════════════════════════════════════════════════════════ */}
        {tab === "jobs" && (
          <div className="lg:hidden">
            <header className="flex items-center justify-between pb-2 pt-6">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.15em] text-[#17633a]">
                  Delivery Jobs
                </div>
                <h1 className="mt-1 text-xl font-black tracking-tight text-[#2c3a2f]">
                  Open Jobs
                </h1>
              </div>
              <span className="rounded-full bg-[#17633a]/10 px-3 py-1 text-xs font-black text-[#17633a]">
                {jobs.length} available
              </span>
            </header>

            {loading && (
              <div className="mt-12 flex flex-col items-center gap-3 text-sm font-bold text-[#637067]">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#ccd5ca] border-t-[#17633a]" />
                Loading jobs...
              </div>
            )}

            {!loading && jobs.length === 0 && (
              <div className="mt-6 rounded-2xl border border-dashed border-[#ccd5ca] bg-white/60 p-8 text-center text-sm text-[#637067]">
                No open jobs in your service provinces right now. New jobs appear
                here the moment suppliers publish them.
              </div>
            )}

            {!loading && jobs.length > 0 && (
              <div className="mt-4 space-y-3">
                {jobs.map((job) => (
                  <article
                    key={job.orderId}
                    className="rounded-2xl bg-white p-4 shadow-sm"
                  >
                    {/* Top row: order # + date */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-black text-[#17633a]">
                        {job.orderNumber}
                      </span>
                      <span className="text-[10px] font-bold text-[#8a948b]">
                        {job.publishedAt
                          ? formatDate(job.publishedAt)
                          : ""}
                      </span>
                    </div>

                    {/* Route: from → to */}
                    <div className="mt-3 flex items-center gap-2">
                      <MapPinIcon className="h-4 w-4 flex-shrink-0 text-[#17633a]" />
                      <span className="text-sm font-bold text-[#2c3a2f]">
                        {job.pickupCity ?? "Pickup TBC"}
                      </span>
                      <ArrowRightIcon
                        className="h-4 w-4 flex-shrink-0 text-[#17633a]"
                        strokeWidth={2.2}
                      />
                      <span className="text-sm font-bold text-[#2c3a2f]">
                        {job.dropoffCity ?? "Dropoff TBC"}
                      </span>
                    </div>

                    {/* Details row */}
                    <div className="mt-2 text-xs font-semibold text-[#637067]">
                      {job.supplierBusinessName ?? "Supplier"} ·{" "}
                      {job.itemCount} item{job.itemCount === 1 ? "" : "s"}
                      {job.dropoffProvince
                        ? ` · ${job.dropoffProvince}`
                        : ""}
                    </div>

                    {/* Claim button */}
                    <button
                      type="button"
                      disabled={claimingId === job.orderId}
                      onClick={() => void claimJob(job)}
                      className="mt-4 w-full rounded-xl bg-[#17633a] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#0f4d2b] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {claimingId === job.orderId
                        ? "Claiming..."
                        : "Claim this job"}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
           DELIVERIES / TRACKING TAB
           ════════════════════════════════════════════════════════════════ */}
        {tab === "deliveries" && (
          <div className="lg:hidden">
            <header className="flex items-center justify-between pb-2 pt-6">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.15em] text-[#17633a]">
                  Tracking
                </div>
                <h1 className="mt-1 text-xl font-black tracking-tight text-[#2c3a2f]">
                  My Deliveries
                </h1>
              </div>
              <span className="rounded-full bg-[#17633a]/10 px-3 py-1 text-xs font-black text-[#17633a]">
                {active.length} active
              </span>
            </header>

            {loading && (
              <div className="mt-12 flex flex-col items-center gap-3 text-sm font-bold text-[#637067]">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#ccd5ca] border-t-[#17633a]" />
                Loading deliveries...
              </div>
            )}

            {/* Active deliveries */}
            {!loading && active.length === 0 && (
              <div className="mt-6 rounded-2xl border border-dashed border-[#ccd5ca] bg-white/60 p-8 text-center text-sm text-[#637067]">
                Nothing in progress. Claim a job to get started.
              </div>
            )}

            {!loading && active.length > 0 && (
              <div className="mt-4 space-y-3">
                {active.map((delivery) => {
                  const chip = STATUS_CHIP[delivery.status];

                  return (
                    <div
                      key={delivery.orderId}
                      className="rounded-2xl bg-white p-4 shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedDelivery(delivery)}
                        className="w-full text-left"
                      >
                      {/* Top: icon + ID + status */}
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f2f4ef]">
                          <BoxIcon className="h-6 w-6 text-[#17633a]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-black text-[#2c3a2f]">
                            {delivery.order.orderNumber}
                          </div>
                          <div className="truncate text-xs text-[#637067]">
                            {itemSummary(delivery.order.items)}
                          </div>
                        </div>
                        <span
                          className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${chip.cls}`}
                        >
                          {chip.label}
                        </span>
                      </div>

                      {/* Stepper */}
                      <div className="mt-3 px-1">
                        <ProgressStepper status={delivery.status} />
                      </div>

                      {/* Route + Date */}
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <div>
                          <div className="text-[10px] font-semibold text-[#8a948b]">
                            {formatDate(delivery.order.createdAt)}
                          </div>
                          <div className="mt-0.5 font-bold text-[#2c3a2f]">
                            {delivery.order.deliveryAddress.city}
                          </div>
                        </div>
                        <ArrowRightIcon
                          className="h-4 w-4 text-[#17633a]"
                          strokeWidth={2.2}
                        />
                        <div className="text-right">
                          <div className="text-[10px] font-semibold text-[#8a948b]">
                            {formatDate(
                              delivery.deliveredAt ??
                                delivery.pickedUpAt ??
                                delivery.order.createdAt,
                            )}
                          </div>
                          <div className="mt-0.5 font-bold text-[#2c3a2f]">
                            {delivery.order.deliveryAddress.city}
                            {delivery.order.deliveryAddress.province
                              ? `, ${delivery.order.deliveryAddress.province}`
                              : ""}
                          </div>
                        </div>
                      </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTrackedDelivery(delivery)}
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#17633a]/[0.08] px-4 py-2.5 text-xs font-black text-[#17633a] transition active:scale-[0.98]"
                      >
                        <MapPinIcon className="h-4 w-4" />
                        Track live on map
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* History */}
            {!loading && history.length > 0 && (
              <section className="mt-8">
                <h2 className="text-base font-black text-[#2c3a2f]">
                  History
                </h2>
                <div className="mt-3 space-y-2">
                  {history.map((d) => {
                    const chip = STATUS_CHIP[d.status];
                    return (
                      <div
                        key={d.orderId}
                        className="flex items-center gap-3 rounded-2xl bg-white/70 p-3"
                      >
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#f2f4ef]">
                          <BoxIcon className="h-5 w-5 text-[#8a948b]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-black text-[#2c3a2f]">
                            {d.order.orderNumber}
                          </div>
                          <div className="truncate text-xs text-[#637067]">
                            {d.order.deliveryAddress.city}
                            {d.status === "FAILED" && d.failedReason
                              ? ` · ${d.failedReason}`
                              : ""}
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black ${chip.cls}`}
                          >
                            {chip.label}
                          </span>
                          <span className="text-[10px] font-bold text-[#8a948b]">
                            {formatDate(
                              d.deliveredAt ?? d.failedAt ?? d.pickedUpAt,
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
           PROFILE TAB
           ════════════════════════════════════════════════════════════════ */}
        {tab === "profile" && (
          <div className="lg:hidden">
            <header className="pb-2 pt-6">
              <div className="text-xs font-black uppercase tracking-[0.15em] text-[#17633a]">
                Transporter
              </div>
              <h1 className="mt-1 text-xl font-black tracking-tight text-[#2c3a2f]">
                Profile
              </h1>
            </header>

            {/* Account + business details — the real account, editable here. */}
            <div className="mt-5">
              <TransporterSettings idPrefix="tp" />
            </div>

            {/* Stats row */}
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
                <div className="text-2xl font-black text-[#17633a]">
                  {active.length}
                </div>
                <div className="mt-1 text-[10px] font-bold uppercase text-[#8a948b]">
                  Active
                </div>
              </div>
              <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
                <div className="text-2xl font-black text-[#17633a]">
                  {history.filter((h) => h.status === "DELIVERED").length}
                </div>
                <div className="mt-1 text-[10px] font-bold uppercase text-[#8a948b]">
                  Completed
                </div>
              </div>
              <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
                <div className="text-2xl font-black text-[#17633a]">
                  {history.filter((h) => h.status === "FAILED").length}
                </div>
                <div className="mt-1 text-[10px] font-bold uppercase text-[#8a948b]">
                  Failed
                </div>
              </div>
            </div>

            {/* Appearance */}
            <AppearanceSection className="mt-4 shadow-sm" />

            {/* Menu items */}
            <div className="mt-5 space-y-2">
              <Link
                href="/"
                className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm transition active:scale-[0.99]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f2f4ef]">
                  <HomeIcon className="h-5 w-5 text-[#17633a]" />
                </div>
                <span className="flex-1 text-sm font-bold text-[#2c3a2f]">
                  Go to Marketplace
                </span>
                <ArrowRightIcon className="h-4 w-4 text-[#8a948b]" />
              </Link>

              <button
                type="button"
                onClick={() => {
                  clearAuth();
                  router.push("/login");
                }}
                className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm transition active:scale-[0.99]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50">
                  <LogoutIcon className="h-5 w-5 text-red-600" />
                </div>
                <span className="flex-1 text-sm font-bold text-red-600">
                  Sign Out
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
           DESKTOP — widescreen transport desk. This whole branch is
           display:none until lg, so the phone shell above is what mobile
           users have always seen.
           ════════════════════════════════════════════════════════════════ */}
        <div className="hidden lg:block">
          {loading ? (
            <div className="flex items-center gap-3 py-16 text-sm font-bold text-ink-muted">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
              Loading your transport desk...
            </div>
          ) : unverified ? (
            <>
              <div className="rounded-3xl border border-warning/40 bg-warning-soft p-6">
                <h2 className="text-sm font-black text-warning-bright">
                  Profile being verified
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-warning-bright">
                  The BonAgri team verifies transporter profiles before delivery
                  jobs become visible. You will be notified once verified.
                </p>
              </div>

              {/* A pending transporter still needs somewhere to fill in the
                  details verification looks at, so the settings section stays
                  reachable on this tab. */}
              {tab === "profile" ? (
                <div className="mt-4 space-y-4">
                  <h2 className="text-sm font-black uppercase tracking-wide text-ink-muted">
                    Settings
                  </h2>
                  <TransporterSettings idPrefix="tp-desk-pending" />
                </div>
              ) : null}
            </>
          ) : tab === "home" ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Open jobs"
                  value={jobs.length}
                  hint="Published in your provinces"
                  Icon={BoxIcon}
                  onTap={() => setTab("jobs")}
                />
                <StatCard
                  label="Active deliveries"
                  value={active.length}
                  hint="Pickup, transit and handover"
                  Icon={TruckIcon}
                  onTap={() => setTab("deliveries")}
                />
                <StatCard
                  label="Completed"
                  value={completedCount}
                  hint="Delivered by your team"
                  Icon={CheckIcon}
                />
                <StatCard
                  label="Failed"
                  value={failedCount}
                  hint="Waiting on re-dispatch"
                  Icon={CloseIcon}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="min-w-0 space-y-4">
                  <DeskSection
                    title="Current deliveries"
                    action={
                      active.length > 3
                        ? { label: "See all", onTap: () => setTab("deliveries") }
                        : undefined
                    }
                  >
                    {active.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted">
                        No active delivery. Claim a job from the board to get
                        started.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {active.slice(0, 3).map((delivery) => (
                          <TrackingCard
                            key={delivery.orderId}
                            delivery={delivery}
                            focused={deskFocused?.orderId === delivery.orderId}
                            onFocus={() => setFocusedId(delivery.orderId)}
                            onOpen={() => setSelectedDelivery(delivery)}
                            onTrack={() => setTrackedDelivery(delivery)}
                          />
                        ))}
                      </div>
                    )}
                  </DeskSection>

                  {history.length > 0 ? (
                    <DeskSection title="Recent activity">
                      <ul className="divide-y divide-line">
                        {history.slice(0, 4).map((delivery) => (
                          <li
                            key={delivery.orderId}
                            className="flex items-center gap-3 py-2.5"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-ink">
                                {delivery.order.orderNumber}
                              </span>
                              <span className="block truncate text-xs text-ink-muted">
                                {delivery.order.deliveryAddress.city}
                                {delivery.status === "FAILED" &&
                                delivery.failedReason
                                  ? ` · ${delivery.failedReason}`
                                  : ""}
                              </span>
                            </span>
                            <span
                              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${STATUS_TONE[delivery.status]}`}
                            >
                              {STATUS_CHIP[delivery.status].label}
                            </span>
                            <span className="w-24 shrink-0 text-right text-xs font-bold text-ink-faint">
                              {formatDate(
                                delivery.deliveredAt ??
                                  delivery.failedAt ??
                                  delivery.pickedUpAt,
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </DeskSection>
                  ) : null}
                </div>

                <div className="min-w-0 lg:sticky lg:top-[88px] lg:h-[calc(100vh-7.5rem)]">
                  <RoutePanel
                    delivery={deskFocused}
                    onOpen={openDesk}
                    onTrack={(delivery) => {
                      setSelectedDelivery(null);
                      setTrackedDelivery(delivery);
                    }}
                  />
                </div>
              </div>

              {jobs.length > 0 ? (
                <DeskSection
                  title="Open jobs"
                  action={{ label: "Open the board", onTap: () => setTab("jobs") }}
                >
                  <div className="grid gap-3 lg:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
                    {jobs.slice(0, 3).map((job) => (
                      <JobCard
                        key={job.orderId}
                        job={job}
                        claiming={claimingId === job.orderId}
                        onClaim={() => void claimJob(job)}
                      />
                    ))}
                  </div>
                </DeskSection>
              ) : null}
            </div>
          ) : tab === "jobs" ? (
            <div className="space-y-4">
              <p className="text-sm text-ink-muted">
                {jobs.length} open
                {jobs.length === 1 ? " job" : " jobs"} — the full address and
                buyer contact unlock once you claim.
              </p>

              {jobs.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-ink-muted">
                  No open jobs in your service provinces right now. New jobs
                  appear here the moment suppliers publish them.
                </p>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
                  {jobs.map((job) => (
                    <JobCard
                      key={job.orderId}
                      job={job}
                      claiming={claimingId === job.orderId}
                      onClaim={() => void claimJob(job)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : tab === "deliveries" ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="min-w-0 space-y-4">
                <FilterBar
                  query={query}
                  onQueryChange={setQuery}
                  status={statusFilter}
                  onStatusChange={setStatusFilter}
                  period={periodFilter}
                  onPeriodChange={setPeriodFilter}
                />

                <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-faint">
                  {deskActive.length} active · {deskHistory.length} in history
                </p>

                {deskActive.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-ink-muted">
                    {active.length === 0
                      ? "Nothing in progress. Claim a job to get started."
                      : "No delivery matches these filters."}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {deskActive.map((delivery) => (
                      <TrackingCard
                        key={delivery.orderId}
                        delivery={delivery}
                        focused={deskFocused?.orderId === delivery.orderId}
                        onFocus={() => setFocusedId(delivery.orderId)}
                        onOpen={() => setSelectedDelivery(delivery)}
                        onTrack={() => setTrackedDelivery(delivery)}
                      />
                    ))}
                  </div>
                )}

                {deskHistory.length > 0 ? (
                  <DeskSection title="History">
                    <ul className="divide-y divide-line">
                      {deskHistory.map((delivery) => (
                        <li
                          key={delivery.orderId}
                          className="flex items-center gap-3 py-2.5"
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedDelivery(delivery)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block truncate text-sm font-bold text-ink">
                              {delivery.order.orderNumber}
                            </span>
                            <span className="block truncate text-xs text-ink-muted">
                              {delivery.order.deliveryAddress.city}
                              {delivery.status === "FAILED" &&
                              delivery.failedReason
                                ? ` · ${delivery.failedReason}`
                                : ""}
                            </span>
                          </button>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${STATUS_TONE[delivery.status]}`}
                          >
                            {STATUS_CHIP[delivery.status].label}
                          </span>
                          <span className="w-24 shrink-0 text-right text-xs font-bold text-ink-faint">
                            {formatDate(
                              delivery.deliveredAt ??
                                delivery.failedAt ??
                                delivery.pickedUpAt,
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </DeskSection>
                ) : null}
              </div>

              <div className="min-w-0 lg:sticky lg:top-[88px] lg:h-[calc(100vh-7.5rem)]">
                <RoutePanel
                  delivery={deskFocused}
                  onOpen={openDesk}
                  onTrack={(delivery) => {
                    setSelectedDelivery(null);
                    setTrackedDelivery(delivery);
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <DeskSection title="Delivery record">
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard
                    label="Active"
                    value={active.length}
                    hint="In progress now"
                    Icon={TruckIcon}
                  />
                  <StatCard
                    label="Completed"
                    value={completedCount}
                    hint="Delivered"
                    Icon={CheckIcon}
                  />
                  <StatCard
                    label="Failed"
                    value={failedCount}
                    hint="Reported"
                    Icon={CloseIcon}
                  />
                </div>

                <div className="mt-4 space-y-2">
                  <Link
                    href="/"
                    className="flex items-center gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3 text-sm font-bold text-ink transition hover:border-line-strong"
                  >
                    <HomeIcon className="h-5 w-5 text-success-bright" />
                    Go to Marketplace
                    <ArrowRightIcon
                      className="ml-auto h-4 w-4 text-ink-faint"
                      strokeWidth={2.2}
                    />
                  </Link>

                  <button
                    type="button"
                    onClick={signOut}
                    className="flex w-full items-center gap-3 rounded-2xl border border-line px-4 py-3 text-left text-sm font-bold text-danger-bright transition hover:bg-danger-soft"
                  >
                    <LogoutIcon className="h-5 w-5" />
                    Sign out
                  </button>
                </div>
              </DeskSection>

              <DeskSection title="Appearance">
                <AppearanceSection className="mt-0" />
              </DeskSection>

              <div className="space-y-4 lg:col-span-2">
                <h2 className="text-sm font-black uppercase tracking-wide text-ink-muted">
                  Settings
                </h2>
                <TransporterSettings idPrefix="tp-desk" />
              </div>
            </div>
          )}
        </div>
          </div>
        </div>
      </div>

      {/* ── Tab Bar (phones and tablets only; the desk uses the rail) ────── */}
      <div className="lg:hidden">
        <TransportTabBar
          view={tab}
          onNavigate={setTab}
          onRefresh={handleRefresh}
          jobCount={jobs.length}
          activeCount={active.length}
        />
      </div>

      {/* ── Delivery Detail Sheet ────────────────────────────────────────── */}
      {selectedDelivery && (
        <DetailSheet
          delivery={selectedDelivery}
          busy={actingId === selectedDelivery.orderId}
          onAction={(d, a) => void deliveryAction(d, a)}
          onFail={(d) => {
            setFailTarget(d);
            setFailReason("");
          }}
          onTrack={(d) => {
            setSelectedDelivery(null);
            setTrackedDelivery(d);
          }}
          onClose={() => setSelectedDelivery(null)}
        />
      )}

      {/* ── Live location tracking overlay ──────────────────────────────── */}
      {trackedDelivery && (
        <LocationTracking
          delivery={trackedDelivery}
          onClose={() => setTrackedDelivery(null)}
        />
      )}

      {/* ── Failure Dialog ───────────────────────────────────────────────── */}
      {failTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-6">
          <form
            onSubmit={(event) => void submitFailure(event)}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h3 className="text-lg font-black text-[#2c3a2f]">
              Report a problem — {failTarget.order.orderNumber}
            </h3>
            <p className="mt-2 text-sm text-[#637067]">
              The order stays where it is; the supplier will decide whether to
              re-dispatch the delivery or handle it another way.
            </p>
            <textarea
              value={failReason}
              onChange={(event) => setFailReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Recipient not reachable, truck broke down..."
              className="mt-4 w-full rounded-xl border border-[#ccd5ca] px-4 py-3 text-sm outline-none focus:border-[#17633a]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFailTarget(null)}
                className="rounded-xl border border-[#ccd5ca] px-4 py-2.5 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={failing}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {failing ? "Saving..." : "Record failure"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Page Export
   ═══════════════════════════════════════════════════════════════════════════ */

export default function TransportPage() {
  return (
    <AuthGuard allowedRoles={["TRANSPORTER"]}>
      <TransportHub />
    </AuthGuard>
  );
}
