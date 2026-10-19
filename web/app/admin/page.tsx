"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authHeaders } from "../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type Stats = {
  users: {
    total: number;
    buyers: number;
    suppliers: number;
    dealers: number;
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
    description:
      "Suspend, reactivate and promote buyers to suppliers or transporters.",
  },
  {
    href: "/admin/suppliers",
    title: "Suppliers",
    description: "Review and verify supplier and dealer profiles.",
  },
  {
    href: "/admin/transporters",
    title: "Transporters",
    description: "Verify transporters who claim and carry delivery jobs.",
  },
  {
    href: "/admin/categories",
    title: "Categories",
    description: "Create and rename marketplace categories.",
  },
  {
    href: "/admin/orders",
    title: "Orders",
    description: "Platform-wide order overview with buyer details.",
  },
];

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

  const inProgress =
    stats !== null
      ? stats.orders.confirmed +
        stats.orders.processing +
        stats.orders.readyForDelivery +
        stats.orders.outForDelivery
      : 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Live platform statistics across users, products and orders.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading statistics...</p>
      ) : stats ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Users
              </div>
              <div className="mt-2 text-3xl font-bold text-slate-900">
                {stats.users.total}
              </div>
              <div className="mt-2 text-xs text-slate-600">
                {stats.users.buyers} buyers · {stats.users.suppliers}{" "}
                suppliers · {stats.users.dealers} dealers ·{" "}
                {stats.users.admins} admins
              </div>
              {stats.users.suspended > 0 ? (
                <div className="mt-1 text-xs font-semibold text-red-600">
                  {stats.users.suspended} suspended
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Products
              </div>
              <div className="mt-2 text-3xl font-bold text-slate-900">
                {stats.products.active}
              </div>
              <div className="mt-2 text-xs text-slate-600">
                live listings · {stats.products.draft} draft ·{" "}
                {stats.products.inactive} inactive
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Orders
              </div>
              <div className="mt-2 text-3xl font-bold text-slate-900">
                {stats.orders.total}
              </div>
              <div className="mt-2 text-xs text-slate-600">
                {stats.orders.pending} pending · {inProgress} in progress ·{" "}
                {stats.orders.delivered} delivered
              </div>
              {stats.orders.cancelled > 0 ? (
                <div className="mt-1 text-xs text-slate-500">
                  {stats.orders.cancelled} cancelled
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Revenue (excl. cancelled)
              </div>
              <div className="mt-2 text-3xl font-bold text-emerald-700">
                R{Number(stats.revenue.net).toLocaleString("en-ZA", {
                  minimumFractionDigits: 2,
                })}
              </div>
              <div className="mt-2 text-xs text-slate-600">
                gross R{Number(stats.revenue.gross).toLocaleString("en-ZA", {
                  minimumFractionDigits: 2,
                })}
              </div>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {SECTIONS.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/40"
              >
                <h2 className="text-base font-bold text-slate-900">
                  {section.title} →
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  {section.description}
                </p>
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
