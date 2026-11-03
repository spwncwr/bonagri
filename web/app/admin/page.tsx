"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  BasketIcon,
  BoxIcon,
  ChevronRightIcon,
  PlusIcon,
  StoreIcon,
  TruckIcon,
  UserIcon,
} from "../../components/mobile/icons";
import {
  AdminCard,
  AdminPillLink,
  AdminDashboardSkeleton,
  DonutChart,
  RingProgress,
  SegmentBar,
} from "../../components/admin/admin-ui";
import { authHeaders } from "../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type Stats = {
  users: {
    total: number;
    buyers: number;
    suppliers: number;
    dealers: number;
    transporters: number;
    admins: number;
    suspended: number;
  };
  products: {
    total: number;
    active: number;
    draft: number;
    inactive: number;
  };
  orders: {
    total: number;
    pending: number;
    confirmed: number;
    processing: number;
    readyForDelivery: number;
    outForDelivery: number;
    delivered: number;
    cancelled: number;
  };
  revenue: {
    net: string | number;
    gross: string | number;
  };
};

const SECTIONS = [
  {
    href: "/admin/users",
    title: "Users",
    description: "Suspend, reactivate and promote accounts.",
    icon: UserIcon,
  },
  {
    href: "/admin/suppliers",
    title: "Suppliers",
    description: "Verify supplier and agro-dealer profiles.",
    icon: StoreIcon,
  },
  {
    href: "/admin/transporters",
    title: "Transporters",
    description: "Verify the carriers taking delivery jobs.",
    icon: TruckIcon,
  },
  {
    href: "/admin/categories",
    title: "Categories",
    description: "Shape the marketplace filter bar.",
    icon: BoxIcon,
  },
  {
    href: "/admin/orders",
    title: "Orders",
    description: "Every order on the platform, newest first.",
    icon: BasketIcon,
  },
];

function rand(value: string | number) {
  return `R${Number(value).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
  })}`;
}

function share(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/admin/stats`, {
          cache: "no-store",
          headers: authHeaders(),
        });

        if (!response.ok) {
          throw new Error("Unable to load platform statistics");
        }

        const data = (await response.json()) as Stats;

        if (!cancelled) {
          setStats(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load statistics",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">
            Dashboard
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Live platform statistics across users, products and orders.
          </p>
        </div>

        <AdminPillLink href="/">
          Open marketplace
          <ArrowRightIcon className="h-4 w-4" />
        </AdminPillLink>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <AdminDashboardSkeleton />
      ) : stats ? (
        <DashboardGrid stats={stats} />
      ) : null}
    </div>
  );
}

function DashboardGrid({ stats }: { stats: Stats }) {
  const inProgress =
    stats.orders.confirmed +
    stats.orders.processing +
    stats.orders.readyForDelivery +
    stats.orders.outForDelivery;

  const pipeline = [
    { label: "Pend", value: stats.orders.pending, tone: "#38bdf8" },
    { label: "Conf", value: stats.orders.confirmed, tone: "#34d399" },
    { label: "Proc", value: stats.orders.processing, tone: "#34d399" },
    { label: "Ready", value: stats.orders.readyForDelivery, tone: "#34d399" },
    { label: "Out", value: stats.orders.outForDelivery, tone: "#34d399" },
    { label: "Deliv", value: stats.orders.delivered, tone: "#2dd4bf" },
    { label: "Canc", value: stats.orders.cancelled, tone: "#fb7185" },
  ];

  const maxPipeline = Math.max(...pipeline.map((bar) => bar.value), 1);

  const userMix = [
    { label: "Buyers", value: stats.users.buyers, color: "#34d399" },
    { label: "Suppliers", value: stats.users.suppliers, color: "#2dd4bf" },
    { label: "Agro-dealers", value: stats.users.dealers, color: "#fbbf24" },
    { label: "Transporters", value: stats.users.transporters, color: "#38bdf8" },
    { label: "Admins", value: stats.users.admins, color: "#a78bfa" },
  ].filter((slice) => slice.value > 0);

  const community = [
    { label: "Buyers", value: stats.users.buyers, tone: "#34d399" },
    { label: "Suppliers", value: stats.users.suppliers, tone: "#2dd4bf" },
    { label: "Transporters", value: stats.users.transporters, tone: "#38bdf8" },
  ];

  const deliveredShare = share(stats.orders.delivered, stats.orders.total);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
      {/* Revenue — the reference "Total balance" slot. */}
      <AdminCard title="Total revenue" className="xl:col-span-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl font-black tracking-tight text-white">
            {rand(stats.revenue.net)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-black text-emerald-300">
            {deliveredShare}%
            <ArrowRightIcon className="h-3 w-3 -rotate-45" />
          </span>
        </div>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Excludes cancelled orders
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <AdminPillLink href="/admin/orders">View orders</AdminPillLink>
          <AdminPillLink href="/admin/notifications" tone="accent">
            Broadcasts
          </AdminPillLink>
        </div>

        <div className="mt-6 border-t border-white/8 pt-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] font-semibold text-slate-400">
                Gross revenue
              </div>
              <div className="mt-1 text-lg font-black text-white">
                {rand(stats.revenue.gross)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-slate-400">
                Cancelled
              </div>
              <div className="mt-1 text-lg font-black text-white">
                {stats.orders.cancelled}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <SegmentBar
              value={stats.orders.delivered}
              max={stats.orders.total}
            />
            <div className="mt-2.5 flex items-center justify-between text-[11px] font-semibold">
              <span className="text-slate-400">
                {stats.orders.delivered} of {stats.orders.total} orders
                delivered
              </span>
              <span className="text-emerald-300">{deliveredShare}%</span>
            </div>
          </div>
        </div>
      </AdminCard>

      {/* Order pipeline — the reference "Transactions Overview" slot. */}
      <AdminCard
        title="Orders overview"
        className="xl:col-span-5"
        action={
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold text-slate-300">
            All time
          </span>
        }
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="text-3xl font-black tracking-tight text-white">
            {stats.orders.total}
            <span className="ml-2 text-sm font-bold text-slate-500">orders</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] font-semibold text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Fulfilment pipeline
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-400" />
              Cancelled
            </span>
          </div>
        </div>

        <div className="mt-6 flex h-44 items-end gap-2.5">
          {pipeline.map((bar) => (
            <div
              key={bar.label}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${bar.label}: ${bar.value}`}
            >
              <div
                className="w-full rounded-t-lg transition-all"
                style={{
                  height: `${Math.max((bar.value / maxPipeline) * 100, 3)}%`,
                  backgroundColor: bar.tone,
                  opacity: bar.value === 0 ? 0.25 : 0.85,
                }}
              />
              <div className="mt-2 text-center text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {bar.label}
              </div>
              <div className="mt-0.5 text-center text-[11px] font-black text-slate-300">
                {bar.value}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl border border-white/6 bg-white/4 py-3">
            <div className="text-lg font-black text-white">
              {stats.orders.pending}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Awaiting action
            </div>
          </div>
          <div className="rounded-2xl border border-white/6 bg-white/4 py-3">
            <div className="text-lg font-black text-white">{inProgress}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              In progress
            </div>
          </div>
          <div className="rounded-2xl border border-white/6 bg-white/4 py-3">
            <div className="text-lg font-black text-white">
              {stats.orders.delivered}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Delivered
            </div>
          </div>
        </div>
      </AdminCard>

      {/* Right column — supply card + fulfilment rate. */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
        <AdminCard
          title="Marketplace supply"
          action={
            <Link
              href="/admin/categories"
              aria-label="Add a category"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/12 hover:text-white"
            >
              <PlusIcon className="h-4 w-4" />
            </Link>
          }
        >
          <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0f4d2c_0%,#17633a_55%,#2d9d5e_100%)] p-5">
            <svg
              aria-hidden="true"
              viewBox="0 0 320 90"
              className="absolute inset-x-0 bottom-0 h-24 w-full opacity-70"
              preserveAspectRatio="none"
            >
              <path
                d="M0 62 C 40 30, 70 78, 110 52 S 180 20, 220 48 S 290 70, 320 40"
                fill="none"
                stroke="rgba(255,255,255,0.75)"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <div className="relative">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100/80">
                Live listings
              </div>
              <div className="mt-1.5 text-4xl font-black tracking-tight text-white">
                {stats.products.active}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl border border-white/6 bg-white/4 py-2.5">
              <div className="font-black text-white">{stats.products.draft}</div>
              <div className="text-[10px] font-semibold text-slate-500">
                Draft
              </div>
            </div>
            <div className="rounded-xl border border-white/6 bg-white/4 py-2.5">
              <div className="font-black text-white">
                {stats.products.inactive}
              </div>
              <div className="text-[10px] font-semibold text-slate-500">
                Inactive
              </div>
            </div>
            <div className="rounded-xl border border-white/6 bg-white/4 py-2.5">
              <div className="font-black text-white">{stats.products.total}</div>
              <div className="text-[10px] font-semibold text-slate-500">
                Total
              </div>
            </div>
          </div>
        </AdminCard>

        <AdminCard title="Fulfilment rate">
          <SegmentBar
            value={stats.orders.delivered}
            max={stats.orders.total}
            segments={16}
            tone="#2dd4bf"
          />
          <div className="mt-3 flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-400">
              {stats.orders.delivered} delivered of {stats.orders.total}
            </span>
            <span className="text-teal-300">{deliveredShare}%</span>
          </div>

          <div className="mt-5 space-y-2.5 text-xs">
            <div className="flex items-center justify-between rounded-xl border border-white/6 bg-white/4 px-3.5 py-2.5">
              <span className="font-semibold text-slate-300">
                Suspended accounts
              </span>
              <span className="font-black text-white">
                {stats.users.suspended}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/6 bg-white/4 px-3.5 py-2.5">
              <span className="font-semibold text-slate-300">
                Orders awaiting action
              </span>
              <span className="font-black text-white">
                {stats.orders.pending}
              </span>
            </div>
          </div>
        </AdminCard>
      </div>

      {/* Community rings — the reference "Financial goals" slot. */}
      <AdminCard
        title="Platform community"
        className="xl:col-span-5"
        action={
          <Link
            href="/admin/users"
            aria-label="Open users"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/12 hover:text-white"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </Link>
        }
      >
        <div className="space-y-3">
          {community.map((row) => (
            <div
              key={row.label}
              className="flex items-center gap-4 rounded-2xl border border-white/6 bg-white/4 px-4 py-3.5"
            >
              <RingProgress
                value={share(row.value, stats.users.total)}
                tone={row.tone}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black text-white">{row.label}</div>
                <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                  {share(row.value, stats.users.total)}% of{" "}
                  {stats.users.total} accounts
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Members
                </div>
                <div className="text-base font-black text-white">
                  {row.value.toLocaleString("en-ZA")}
                </div>
              </div>
            </div>
          ))}
        </div>
      </AdminCard>

      {/* User mix donut — the reference "All Expenses" slot. */}
      <AdminCard title="User mix" className="xl:col-span-3">
        <div className="flex flex-col items-center">
          <DonutChart
            slices={userMix}
            centerLabel="Total"
            centerValue={stats.users.total.toLocaleString("en-ZA")}
            size={170}
          />
          <div className="mt-5 grid w-full grid-cols-2 gap-x-4 gap-y-2 text-[11px] font-semibold">
            {userMix.map((slice) => (
              <div key={slice.label} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="truncate text-slate-300">{slice.label}</span>
                <span className="ml-auto font-black text-white">
                  {slice.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </AdminCard>

      {/* Manage shortcuts — the reference "Recent Transaction" slot. */}
      <AdminCard
        title="Manage"
        className="xl:col-span-4"
        action={
          <Link
            href="/admin/applications"
            aria-label="Open applications"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/12 hover:text-white"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </Link>
        }
      >
        <div className="space-y-2.5">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="flex items-center gap-3.5 rounded-2xl border border-white/6 bg-white/4 px-4 py-3 transition hover:border-emerald-400/25 hover:bg-white/8"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
                <section.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black text-white">
                  {section.title}
                </span>
                <span className="block truncate text-[11px] font-semibold text-slate-500">
                  {section.description}
                </span>
              </span>
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-600" />
            </Link>
          ))}
        </div>
      </AdminCard>
    </div>
  );
}
