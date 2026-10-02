"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

const SUPPLIER_USER_ID = "ae53df0e-9536-4fb1-a195-5c8c1c75ee74";

type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PROCESSING"
  | "READY_FOR_DELIVERY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";

type SupplierOrderItem = {
  id: string;
  productName: string;
  unitPrice: number | string;
  quantity: number;
  lineTotal: number | string;
  product: {
    id: string;
    name: string;
    unit: string;
    category?: {
      name: string;
    };
  };
};

type SupplierOrder = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  subtotal: number | string;
  deliveryFee: number | string;
  total: number | string;
  createdAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
  items: SupplierOrderItem[];
  deliveryAddress: {
    id: string;
    label?: string | null;
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    province?: string | null;
    postalCode?: string | null;
  };
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  READY_FOR_DELIVERY: "Ready for delivery",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING: "CONFIRMED",
  CONFIRMED: "PROCESSING",
  PROCESSING: "READY_FOR_DELIVERY",
  READY_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  OUT_FOR_DELIVERY: "DELIVERED",
};

const STATUS_STYLES: Record<OrderStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  CONFIRMED: "bg-blue-50 text-blue-700 border-blue-200",
  PROCESSING: "bg-violet-50 text-violet-700 border-violet-200",
  READY_FOR_DELIVERY: "bg-cyan-50 text-cyan-700 border-cyan-200",
  OUT_FOR_DELIVERY: "bg-indigo-50 text-indigo-700 border-indigo-200",
  DELIVERED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

function money(value: number | string) {
  return `R${Number(value).toFixed(2)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function SupplierPage() {
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"ALL" | OrderStatus>("ALL");

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders/supplier?userId=${SUPPLIER_USER_ID}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("Unable to load supplier orders");
      }

      const data = (await response.json()) as SupplierOrder[];
      setOrders(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load supplier orders",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchOrders = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/orders/supplier?userId=${SUPPLIER_USER_ID}`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          throw new Error("Unable to load supplier orders");
        }

        const data = (await response.json()) as SupplierOrder[];

        if (!cancelled) {
          setOrders(data);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load supplier orders",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchOrders();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateStatus = async (
    orderId: string,
    status: OrderStatus,
  ) => {
    setUpdatingOrderId(orderId);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders/${orderId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message ?? "Unable to update order");
      }

      await loadOrders();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update order",
      );
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const cancelOrder = async (order: SupplierOrder) => {
    const confirmed = window.confirm(
      `Cancel order ${order.orderNumber}? Reserved stock will be released.`,
    );

    if (!confirmed) {
      return;
    }

    await updateStatus(order.id, "CANCELLED");
  };

  const filteredOrders = useMemo(() => {
    if (filter === "ALL") {
      return orders;
    }

    return orders.filter((order) => order.status === filter);
  }, [filter, orders]);

  const counts = useMemo(
    () => ({
      total: orders.length,
      pending: orders.filter((order) => order.status === "PENDING").length,
      active: orders.filter((order) =>
        ["CONFIRMED", "PROCESSING", "READY_FOR_DELIVERY"].includes(
          order.status,
        ),
      ).length,
      delivery: orders.filter(
        (order) => order.status === "OUT_FOR_DELIVERY",
      ).length,
      completed: orders.filter(
        (order) => order.status === "DELIVERED",
      ).length,
    }),
    [orders],
  );

  return (
    <main className="min-h-screen bg-[#f6f7f2] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
              BonAgri
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Supplier Operations
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Manage incoming orders, fulfilment and delivery readiness.
            </p>
          </div>

          <Link
          href="/"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Marketplace
        </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard label="Total orders" value={counts.total} />
          <SummaryCard label="Pending" value={counts.pending} />
          <SummaryCard label="Active" value={counts.active} />
          <SummaryCard label="Delivery" value={counts.delivery} />
          <SummaryCard label="Delivered" value={counts.completed} />
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Order queue</h2>
              <p className="mt-1 text-sm text-slate-500">
                Move each order through the BonAgri fulfilment lifecycle.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["ALL", "All"],
                  ["PENDING", "Pending"],
                  ["CONFIRMED", "Confirmed"],
                  ["PROCESSING", "Processing"],
                  ["READY_FOR_DELIVERY", "Ready"],
                  ["OUT_FOR_DELIVERY", "Delivery"],
                  ["DELIVERED", "Delivered"],
                  ["CANCELLED", "Cancelled"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    filter === value
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center text-sm text-slate-500">
              Loading supplier orders...
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-medium text-slate-700">
                No orders in this queue.
              </p>
              <p className="mt-1 text-sm text-slate-500">
                New buyer orders will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {filteredOrders.map((order) => {
                const nextStatus = NEXT_STATUS[order.status];
                const updating = updatingOrderId === order.id;

                return (
                  <article
                    key={order.id}
                    className="rounded-2xl border border-slate-200 p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">
                            {order.orderNumber}
                          </h3>

                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[order.status]}`}
                          >
                            {STATUS_LABELS[order.status]}
                          </span>
                        </div>

                        <p className="mt-1 text-xs text-slate-500">
                          {formatDate(order.createdAt)}
                        </p>
                      </div>

                      <div className="text-left lg:text-right">
                        <p className="text-xs text-slate-500">
                          Order total
                        </p>
                        <p className="text-lg font-semibold">
                          {money(order.total)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-5 lg:grid-cols-[1.3fr_1fr_1fr]">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          Products
                        </p>

                        <div className="mt-2 space-y-2">
                          {order.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3"
                            >
                              <div>
                                <p className="text-sm font-medium">
                                  {item.productName}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {item.quantity} {item.product.unit} ×{" "}
                                  {money(item.unitPrice)}
                                </p>
                              </div>

                              <p className="text-sm font-semibold">
                                {money(item.lineTotal)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          Buyer
                        </p>

                        <div className="mt-2 text-sm">
                          <p className="font-medium">
                            {order.user.firstName} {order.user.lastName}
                          </p>
                          <p className="mt-1 text-slate-500">
                            {order.user.email}
                          </p>
                          {order.user.phone && (
                            <p className="mt-1 text-slate-500">
                              {order.user.phone}
                            </p>
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          Delivery
                        </p>

                        <div className="mt-2 text-sm">
                          {order.deliveryAddress.label && (
                            <p className="font-medium">
                              {order.deliveryAddress.label}
                            </p>
                          )}
                          <p>{order.deliveryAddress.addressLine1}</p>
                          {order.deliveryAddress.addressLine2 && (
                            <p>{order.deliveryAddress.addressLine2}</p>
                          )}
                          <p>
                            {order.deliveryAddress.city}
                            {order.deliveryAddress.province
                              ? `, ${order.deliveryAddress.province}`
                              : ""}
                          </p>
                          {order.deliveryAddress.postalCode && (
                            <p>{order.deliveryAddress.postalCode}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {(nextStatus || order.status === "PENDING") && (
                      <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                        {nextStatus ? (
                          <p className="text-xs text-slate-500">
                            Next step:{" "}
                            <span className="font-semibold text-slate-700">
                              {STATUS_LABELS[nextStatus]}
                            </span>
                          </p>
                        ) : (
                          <span />
                        )}

                        <div className="flex gap-2">
                          {order.status === "PENDING" && (
                            <button
                              type="button"
                              disabled={updating}
                              onClick={() => void cancelOrder(order)}
                              className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          )}

                          {nextStatus && (
                            <button
                              type="button"
                              disabled={updating}
                              onClick={() =>
                                void updateStatus(order.id, nextStatus)
                              }
                              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {updating
                                ? "Updating..."
                                : STATUS_LABELS[nextStatus]}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">
        {value}
      </p>
    </div>
  );
}
