"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { BrandIcon } from "../brand/logo";
import { AppearanceSection } from "../theme/theme-switch";
import NotificationsPanel from "../notifications/notifications-panel";
import {
  ArrowRightIcon,
  BellIcon,
  BoxIcon,
  CloseIcon,
  GlobeIcon,
  HomeIcon,
  LogoutIcon,
  MapPinIcon,
  SearchIcon,
  TruckIcon,
  UserIcon,
} from "../mobile/icons";
import { fetchCurrentUser, type AuthUser } from "../../lib/auth";
import { resolvePoint } from "../../lib/geo";
import LiveMap from "./live-map";
import type { Delivery, DeliveryOrder, Job } from "../../lib/transport";

export type TransportView = "home" | "jobs" | "deliveries" | "profile";

/* ═══════════════════════════════════════════════════════════════════════════
   Shared delivery vocabulary (used by both the phone shell and the desk)
   ═══════════════════════════════════════════════════════════════════════════ */

export const STATUS_CHIP: Record<
  Delivery["status"],
  { label: string; cls: string }
> = {
  ASSIGNED: { label: "Claimed", cls: "bg-amber-100 text-amber-800" },
  PICKED_UP: { label: "Picked Up", cls: "bg-sky-100 text-sky-800" },
  IN_TRANSIT: { label: "In Transit", cls: "bg-indigo-100 text-indigo-800" },
  DELIVERED: { label: "Delivered", cls: "bg-emerald-100 text-emerald-800" },
  FAILED: { label: "Failed", cls: "bg-red-100 text-red-700" },
};

// The desk speaks in theme tokens so the same chip reads correctly in light
// and dark without a legacy-class mapping.
export const STATUS_TONE: Record<Delivery["status"], string> = {
  ASSIGNED: "bg-warning-soft text-warning-bright",
  PICKED_UP: "bg-info-soft text-info-bright",
  IN_TRANSIT: "bg-brand/10 text-success-bright",
  DELIVERED: "bg-success-soft text-success-bright",
  FAILED: "bg-danger-soft text-danger-bright",
};

export const STEP_INDEX: Record<Delivery["status"], number> = {
  ASSIGNED: 0,
  PICKED_UP: 1,
  IN_TRANSIT: 2,
  DELIVERED: 3,
  FAILED: -1,
};

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function itemSummary(items: DeliveryOrder["items"]): string {
  if (items.length === 0) return "No items";
  const first = `${items[0].quantity}× ${items[0].product.name}`;
  if (items.length === 1) return first;
  return `${first} +${items.length - 1} more`;
}

// The desk card names the date it actually knows about, never a placeholder ETA.
export function milestoneOf(delivery: Delivery): { label: string; at: string | null } {
  if (delivery.status === "DELIVERED")
    return { label: "Completed", at: delivery.deliveredAt };
  if (delivery.status === "FAILED")
    return { label: "Failed", at: delivery.failedAt };
  if (delivery.estimatedDate) return { label: "ETA", at: delivery.estimatedDate };
  return { label: "Created", at: delivery.order.createdAt };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Progress stepper — 4 dots joined by solid/dashed lines
   ═══════════════════════════════════════════════════════════════════════════ */

export function ProgressStepper({
  status,
  showLabels = false,
}: {
  status: Delivery["status"];
  showLabels?: boolean;
}) {
  const current = STEP_INDEX[status];
  const failed = status === "FAILED";
  const labels = ["Claimed", "Picked Up", "In Transit", "Delivered"];

  return (
    <div className="w-full">
      <div className="flex items-center">
        {labels.map((label, i) => {
          const done = !failed && i <= current;
          const last = i === labels.length - 1;

          return (
            <div
              key={label}
              className={`flex items-center ${last ? "" : "flex-1"}`}
            >
              <div
                className={`h-3 w-3 flex-shrink-0 rounded-full border-2 transition-colors ${
                  failed
                    ? "border-red-400 bg-red-400"
                    : done
                      ? "border-[#17633a] bg-[#17633a]"
                      : "border-[#ccd5ca] bg-white"
                }`}
              />
              {!last && (
                <div
                  className={`h-0 flex-1 border-t-2 ${
                    !failed && i < current
                      ? "border-solid border-[#17633a]"
                      : "border-dashed border-[#ccd5ca]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {showLabels && (
        <div className="mt-1.5 flex justify-between">
          {labels.map((label, i) => {
            const done = !failed && i <= current;
            return (
              <span
                key={label}
                className={`text-[9px] font-bold ${
                  done ? "text-[#17633a]" : "text-[#8a948b]"
                }`}
              >
                {label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Desktop icon rail
   ═══════════════════════════════════════════════════════════════════════════ */

const RAIL: {
  key: TransportView;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { key: "home", label: "Home", Icon: HomeIcon },
  { key: "jobs", label: "Open jobs", Icon: BoxIcon },
  { key: "deliveries", label: "Tracking", Icon: TruckIcon },
  { key: "profile", label: "Profile", Icon: UserIcon },
];

export function TransportRail({
  view,
  onNavigate,
  jobCount,
  activeCount,
  onSignOut,
}: {
  view: TransportView;
  onNavigate: (next: TransportView) => void;
  jobCount: number;
  activeCount: number;
  onSignOut: () => void;
}) {
  const badgeFor = (key: TransportView) =>
    key === "jobs" ? jobCount : key === "deliveries" ? activeCount : 0;

  return (
    <aside
      aria-label="Transport desk navigation"
      className="sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col items-center justify-between border-r border-line bg-surface py-4 lg:flex"
    >
      <div className="flex flex-col items-center gap-3">
        <Link href="/" aria-label="BonAgri marketplace" className="mb-1">
          <BrandIcon size={30} className="rounded-xl" />
        </Link>

        {RAIL.map(({ key, label, Icon }) => {
          const badge = badgeFor(key);
          const active = view === key;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              aria-current={active ? "page" : undefined}
              aria-label={label}
              title={label}
              className={`relative flex h-11 w-11 items-center justify-center rounded-2xl transition ${
                active
                  ? "bg-ink text-page"
                  : "text-ink-faint hover:bg-surface-raised hover:text-ink"
              }`}
            >
              <Icon className="h-5 w-5" />
              {badge > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-black text-brand-ink">
                  {badge > 9 ? "9+" : badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-2">
        <Link
          href="/"
          aria-label="Marketplace"
          title="Marketplace"
          className="flex h-11 w-11 items-center justify-center rounded-2xl text-ink-faint transition hover:bg-surface-raised hover:text-ink"
        >
          <GlobeIcon className="h-5 w-5" />
        </Link>

        <button
          type="button"
          onClick={onSignOut}
          aria-label="Sign out"
          title="Sign out"
          className="flex h-11 w-11 items-center justify-center rounded-2xl text-ink-faint transition hover:bg-danger-soft hover:text-danger-bright"
        >
          <LogoutIcon className="h-5 w-5" />
        </button>
      </div>
    </aside>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Desktop header bar
   ═══════════════════════════════════════════════════════════════════════════ */

export function TransportHeader({
  title,
  subtitle,
  busy,
  onRefresh,
  onSignOut,
}: {
  title: string;
  subtitle: string;
  busy: boolean;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [panel, setPanel] = useState<"none" | "bell" | "account">("none");

  useEffect(() => {
    let cancelled = false;

    void fetchCurrentUser().then((current) => {
      if (!cancelled) setUser(current);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 hidden border-b border-line bg-surface/90 backdrop-blur lg:block">
      <div className="flex items-center gap-4 px-6 py-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-black tracking-tight text-ink">
            {title}
          </p>
          <p className="truncate text-xs text-ink-muted">{subtitle}</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            aria-label="Refresh jobs and deliveries"
            className="flex h-10 items-center gap-2 rounded-full border border-line bg-surface-raised px-3.5 text-xs font-bold text-ink-soft transition hover:text-ink disabled:opacity-50"
          >
            <svg
              className={`h-4 w-4 ${busy ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() =>
                setPanel((current) =>
                  current === "bell" ? "none" : "bell",
                )
              }
              aria-label="Notifications"
              aria-expanded={panel === "bell"}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-muted transition hover:text-ink"
            >
              <BellIcon className="h-4.5 w-4.5" />
            </button>

            {panel === "bell" ? (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setPanel("none")}
                />
                <div className="absolute right-0 z-50 mt-2 w-[380px] rounded-2xl border border-line bg-surface p-2 shadow-xl">
                  <div className="flex items-center justify-between px-2 py-1">
                    <p className="text-sm font-black text-ink">Notifications</p>
                    <button
                      type="button"
                      onClick={() => setPanel("none")}
                      aria-label="Close notifications"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-raised"
                    >
                      <CloseIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="max-h-[60vh] overflow-y-auto">
                    <NotificationsPanel title="Notifications" />
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() =>
                setPanel((current) =>
                  current === "account" ? "none" : "account",
                )
              }
              aria-label="Account menu"
              aria-expanded={panel === "account"}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-sm font-black text-brand-ink transition hover:opacity-90"
            >
              {(user?.firstName ?? "T").slice(0, 1).toUpperCase()}
            </button>

            {panel === "account" ? (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setPanel("none")}
                />
                <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-line bg-surface p-2 shadow-xl">
                  <p className="px-3 pb-1 pt-2 text-xs font-bold text-ink">
                    {user ? `${user.firstName} ${user.lastName}` : "Transporter"}
                  </p>
                  <p className="max-w-full truncate px-3 pb-2 text-[10px] text-ink-muted">
                    {user?.email ?? "Signing in..."}
                  </p>
                  <AppearanceSection className="m-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setPanel("none");
                      onSignOut();
                    }}
                    className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-danger-bright transition hover:bg-danger-soft"
                  >
                    <LogoutIcon className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Desktop KPI cards
   ═══════════════════════════════════════════════════════════════════════════ */

export function StatCard({
  label,
  value,
  hint,
  Icon,
  onTap,
}: {
  label: string;
  value: number;
  hint: string;
  Icon: ComponentType<{ className?: string }>;
  onTap?: () => void;
}) {
  const className =
    "flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-line-strong";

  const body = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-success-bright">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
          {label}
        </span>
        <span className="mt-1 block text-2xl font-black tracking-tight text-ink">
          {value}
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-muted">
          {hint}
        </span>
      </span>
    </>
  );

  return onTap ? (
    <button type="button" onClick={onTap} className={className}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Desktop filter bar (client-side over already loaded deliveries)
   ═══════════════════════════════════════════════════════════════════════════ */

export type StatusFilter = "ALL" | Delivery["status"];
export type PeriodFilter = "ALL" | "7" | "30" | "90";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "ASSIGNED", label: "Claimed" },
  { value: "PICKED_UP", label: "Picked up" },
  { value: "IN_TRANSIT", label: "In transit" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "FAILED", label: "Failed" },
];

const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: "ALL", label: "Any date" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const selectClass =
  "h-10 rounded-xl border border-line bg-field px-2.5 text-xs font-bold text-ink outline-none transition focus:border-line-strong";

export function FilterBar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  period,
  onPeriodChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  status: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  period: PeriodFilter;
  onPeriodChange: (value: PeriodFilter) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="relative flex h-11 items-center">
        <SearchIcon className="pointer-events-none absolute left-3.5 h-4 w-4 text-ink-faint" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search by order number, buyer or city"
          aria-label="Search deliveries"
          className="w-full rounded-xl border border-line bg-field pl-10 pr-3 text-sm text-ink outline-none transition placeholder:text-ink-disabled focus:border-line-strong"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
            className="absolute right-2 flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-raised hover:text-ink"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </label>

      <div className="flex gap-2">
        <select
          value={period}
          onChange={(event) => onPeriodChange(event.target.value as PeriodFilter)}
          aria-label="Filter by date"
          className={`${selectClass} flex-1`}
        >
          {PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(event) => onStatusChange(event.target.value as StatusFilter)}
          aria-label="Filter by status"
          className={`${selectClass} flex-1`}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Desktop tracking card
   ═══════════════════════════════════════════════════════════════════════════ */

function Field({
  label,
  value,
  sub,
  align = "left",
}: {
  label: string;
  value: string;
  sub?: string;
  align?: "left" | "right";
}) {
  return (
    <div className={`min-w-0 ${align === "right" ? "text-right" : ""}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-black text-ink">{value}</p>
      {sub ? (
        <p className="mt-0.5 truncate text-xs text-ink-muted">{sub}</p>
      ) : null}
    </div>
  );
}

export function TrackingCard({
  delivery,
  focused,
  onFocus,
  onOpen,
  onTrack,
}: {
  delivery: Delivery;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onTrack: () => void;
}) {
  const milestone = milestoneOf(delivery);
  const supplier = delivery.order.items[0]?.product.supplier;
  const address = delivery.order.deliveryAddress;

  return (
    <article
      className={`rounded-2xl border bg-surface p-4 transition ${
        focused
          ? "border-line-strong shadow-[0_0_0_1px_var(--theme-border-strong)]"
          : "border-line hover:border-line-strong"
      }`}
    >
      <button type="button" onClick={onFocus} className="w-full text-left">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-black tracking-tight text-ink">
              {delivery.order.orderNumber}
            </p>
            <p className="mt-0.5 truncate text-xs text-ink-muted">
              {itemSummary(delivery.order.items)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
              {milestone.label}
            </p>
            <p className="mt-1 text-sm font-bold text-ink">
              {formatDateTime(milestone.at)}
            </p>
          </div>
        </div>

        <div className="my-3 border-t border-line" />

        <div className="flex items-start gap-3">
          <Field
            label="From"
            value={supplier?.city ?? "Pickup TBC"}
            sub={supplier?.businessName ?? undefined}
          />
          <ArrowRightIcon
            className="mt-6 h-4 w-4 shrink-0 text-success-bright"
            strokeWidth={2.2}
          />
          <Field
            label="To"
            value={`${address.city}${address.province ? `, ${address.province}` : ""}`}
            sub={address.recipientName}
            align="right"
          />
        </div>

        <div className="mt-4">
          <ProgressStepper status={delivery.status} showLabels />
        </div>
      </button>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 rounded-xl bg-brand px-3 py-2.5 text-xs font-black text-brand-ink transition hover:opacity-90"
        >
          Open details
        </button>
        <button
          type="button"
          onClick={onTrack}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-line px-3 py-2.5 text-xs font-black text-ink-soft transition hover:bg-surface-raised"
        >
          <MapPinIcon className="h-4 w-4" />
          Live map
        </button>
      </div>
    </article>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Desktop job board card
   ═══════════════════════════════════════════════════════════════════════════ */

export function JobCard({
  job,
  claiming,
  onClaim,
}: {
  job: Job;
  claiming: boolean;
  onClaim: () => void;
}) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-surface p-4 transition hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <p className="truncate text-sm font-black tracking-tight text-success-bright">
          {job.orderNumber}
        </p>
        <p className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
          {job.publishedAt ? formatDate(job.publishedAt) : "New"}
        </p>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <MapPinIcon className="h-4 w-4 shrink-0 text-ink-muted" />
        <p className="truncate text-sm font-bold text-ink">
          {job.pickupCity ?? "Pickup TBC"}
        </p>
        <ArrowRightIcon
          className="h-4 w-4 shrink-0 text-success-bright"
          strokeWidth={2.2}
        />
        <p className="truncate text-sm font-bold text-ink">
          {job.dropoffCity ?? "Dropoff TBC"}
        </p>
      </div>

      <p className="mt-2 truncate text-xs text-ink-muted">
        {job.supplierBusinessName ?? "Supplier"} · {job.itemCount} item
        {job.itemCount === 1 ? "" : "s"}
        {job.dropoffProvince ? ` · ${job.dropoffProvince}` : ""}
      </p>

      <button
        type="button"
        disabled={claiming}
        onClick={onClaim}
        className="mt-4 w-full shrink-0 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-brand-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {claiming ? "Claiming..." : "Claim this job"}
      </button>
    </article>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Desktop route panel — the widescreen answer to the reference's map column
   ═══════════════════════════════════════════════════════════════════════════ */

export function RoutePanel({
  delivery,
  onOpen,
  onTrack,
}: {
  delivery: Delivery | null;
  onOpen: (delivery: Delivery) => void;
  onTrack: (delivery: Delivery) => void;
}) {
  const supplier = delivery?.order.items[0]?.product.supplier ?? null;
  const address = delivery?.order.deliveryAddress ?? null;

  const pickup = resolvePoint(
    supplier?.lat,
    supplier?.lng,
    supplier?.city,
  );
  const dropoff = resolvePoint(address?.lat, address?.lng, address?.city);
  const drawable = Boolean(pickup.point && dropoff.point);

  return (
    <section className="flex h-full min-h-[440px] flex-col overflow-hidden rounded-3xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
            Delivery route
          </p>
          <p className="mt-0.5 truncate text-sm font-black text-ink">
            {delivery
              ? `${delivery.order.orderNumber} · ${supplier?.city ?? "Pickup TBC"} → ${address?.city ?? "Dropoff TBC"}`
              : "No active delivery"}
          </p>
        </div>
        {delivery ? (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${STATUS_TONE[delivery.status]}`}
          >
            {STATUS_CHIP[delivery.status].label}
          </span>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1">
        {delivery && drawable ? (
          <LiveMap
            pickup={pickup.point}
            dropoff={dropoff.point}
            courier={null}
            trail={[]}
            topInsetPx={24}
            bottomInsetRatio={0.08}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-muted">
            {delivery
              ? "This delivery has no map coordinates yet — pickup and drop-off cities are still enough to plan the run."
              : "Claim a job from the board and its route appears here."}
          </div>
        )}

        {delivery && drawable ? (
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="absolute bottom-1.5 left-2 z-[300] rounded bg-surface/85 px-1.5 py-0.5 text-[9px] font-semibold text-ink-muted backdrop-blur"
          >
            © OpenStreetMap contributors
          </a>
        ) : null}
      </div>

      {delivery ? (
        <div className="flex gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={() => onOpen(delivery)}
            className="flex-1 rounded-xl bg-brand px-3 py-2.5 text-xs font-black text-brand-ink transition hover:opacity-90"
          >
            Open details
          </button>
          <button
            type="button"
            onClick={() => onTrack(delivery)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-line px-3 py-2.5 text-xs font-black text-ink-soft transition hover:bg-surface-raised"
          >
            <TruckIcon className="h-4 w-4" />
            Track live
          </button>
        </div>
      ) : null}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Desktop section card (keeps the reference's card language for lists)
   ═══════════════════════════════════════════════════════════════════════════ */

export function DeskSection({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: { label: string; onTap: () => void };
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-3xl border border-line bg-surface p-4 ${className}`}
    >
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-ink-faint">
          {title}
        </h2>
        {action ? (
          <button
            type="button"
            onClick={action.onTap}
            className="text-xs font-bold text-success-bright hover:underline"
          >
            {action.label}
          </button>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
