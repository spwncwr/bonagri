"use client";

import Link from "next/link";
import NotificationsPanel from "../../components/notifications/notifications-panel";
import PageHeading from "../../components/supplier/page-heading";

import {
  CoveragePanel,
  FlowCard,
  KpiCard,
  PipelineDonut,
  StockHealthCard,
  type CoverageCity,
  type CoverageMarker,
  type StockHealthLine,
} from "../../components/supplier/dashboard-panels";
import { useReportAttention } from "../../components/supplier/attention-context";
import {
  BoxIcon,
  PlusIcon,
  ShieldIcon,
  TruckIcon,
} from "../../components/mobile/icons";
import { resolvePoint } from "../../lib/geo";
import { authHeaders } from "../../lib/auth";
import { useEffect, useMemo, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

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
    lat?: number | null;
    lng?: number | null;
  };
  payment: {
    id: string;
    status: string;
    provider: string;
    amount: number | string;
    transactionRef: string | null;
    paidAt: string | null;
  } | null;
  invoice: {
    id: string;
    invoiceNumber: string;
  } | null;
  delivery: {
    status: string;
    driverName: string | null;
    driverPhone: string | null;
    estimatedDate: string | null;
    trackingNumber: string | null;
    pickedUpAt: string | null;
    deliveredAt: string | null;
    // CP14
    publishedAt: string | null;
    transporterId: string | null;
    failedReason: string | null;
    failedAt: string | null;
    updatedAt: string;
    transporter: { businessName: string } | null;
  } | null;
};

type BuyerRequest = {
  id: string;
  title: string;
  quantity: number;
  unit: string;
  destinationCity: string | null;
  requiredBy: string | null;
  notes: string | null;
  createdAt: string;
  category: { name: string; slug: string } | null;
};

type MyResponse = {
  id: string;
  status: "OPEN" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";
  message: string;
  quotedPrice: string | null;
  quotedUnit: string | null;
  createdAt: string;
  request: {
    id: string;
    title: string;
    quantity: number;
    unit: string;
    destinationCity: string | null;
    status: "OPEN" | "FULFILLED" | "WITHDRAWN";
  };
};

type VendorDispute = {
  id: string;
  reason: string;
  description: string;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "REJECTED";
  resolutionNote: string | null;
  createdAt: string;
  order: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    total: string;
    createdAt: string;
  };
  openedBy: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
};

// Dashboard stock panel mirrors GET /api/supplier/inventory.
type SupplierInventoryLine = {
  productId: string;
  name: string;
  availableQuantity: number;
  reservedQuantity: number;
  quantity: number;
  lowStockLevel: number;
  isLowStock: boolean;
};

export default function SupplierPage() {
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [inventory, setInventory] = useState<SupplierInventoryLine[]>([]);
  const [disputes, setDisputes] = useState<VendorDispute[]>([]);
  const [buyerRequests, setBuyerRequests] = useState<BuyerRequest[]>([]);
  const [myResponses, setMyResponses] = useState<MyResponse[]>([]);

  // The shell (mounted by the layout) shows one bell badge; this screen is
  // the only one that loads all three attention sources, so it reports up.
  const reportAttention = useReportAttention();

  // Stock health panel reads the same endpoint the inventory screen edits, so
  // the dashboard never shows a number the vendor cannot act on.
  useEffect(() => {
    let cancelled = false;

    void fetch(`${API_BASE_URL}/api/supplier/inventory`, {
      cache: "no-store",
      headers: authHeaders(),
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => {
        if (!cancelled) {
          setInventory(Array.isArray(data) ? (data as SupplierInventoryLine[]) : []);
        }
      })
      .catch(() => setInventory([]));

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadDisputes = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/disputes/mine`, {
          cache: "no-store",
          headers: authHeaders(),
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as VendorDispute[];

        if (!cancelled) {
          setDisputes(data);
        }
      } catch {
        // The disputes panel is non-blocking; leave it empty on failure.
      }
    };

    void loadDisputes();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Public demand board (CP7): OPEN requests buyers have posted.
    const loadBuyerRequests = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/product-requests`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as BuyerRequest[];

        if (!cancelled) {
          setBuyerRequests(data.slice(0, 6));
        }
      } catch {
        // The requests panel is non-blocking; leave it empty on failure.
      }
    };

    void loadBuyerRequests();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    // CP9: this vendor's own responses (SUPPLIER/AGRO_DEALER only).
    const loadMyResponses = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/product-requests/responses/mine`,
          {
            cache: "no-store",
            headers: authHeaders(),
          },
        );

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as MyResponse[];

        if (!cancelled) {
          setMyResponses(data);
        }
      } catch {
        // The responses panel is non-blocking; leave it empty on failure.
      }
    };

    void loadMyResponses();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Non-blocking: the KPI cards fall back to zero on failure, exactly like
    // the inventory and disputes panels beside them.
    const fetchOrders = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/orders/supplier`,
          {
            cache: "no-store",
            headers: authHeaders(),
          },
        );

        if (!response.ok) {
          throw new Error("Unable to load supplier orders");
        }

        const data = (await response.json()) as SupplierOrder[];

        if (!cancelled) {
          setOrders(data);
        }
      } catch {
        // Leave the cards at zero; the queue screen shows its own error.
      }
    };

    void fetchOrders();

    return () => {
      cancelled = true;
    };
  }, []);

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
      cancelled: orders.filter(
        (order) => order.status === "CANCELLED",
      ).length,
      byStatus: orders.reduce<Record<string, number>>((acc, order) => {
        acc[order.status] = (acc[order.status] ?? 0) + 1;
        return acc;
      }, {}),
      awaitingPayment: orders.filter(
        (order) =>
          order.payment?.provider === "MANUAL_EFT" &&
          order.payment.status === "PENDING",
      ).length,
      // Money arrives as Decimal strings; summing once here keeps the KPI card
      // honest about what has actually been delivered.
      deliveredValue: orders
        .filter((order) => order.status === "DELIVERED")
        .reduce((sum, order) => sum + Number(order.total), 0),
      openOrders: orders.filter((order) =>
        [
          "PENDING",
          "CONFIRMED",
          "PROCESSING",
          "READY_FOR_DELIVERY",
          "OUT_FOR_DELIVERY",
        ].includes(order.status),
      ).length,
    }),
    [orders],
  );

  const stockLines = useMemo<StockHealthLine[]>(
    () =>
      [...inventory]
        .sort(
          (a, b) =>
            Number(a.isLowStock) - Number(b.isLowStock) ||
            a.availableQuantity - b.availableQuantity,
        )
        .slice(0, 5)
        .map((line) => ({
          productId: line.productId,
          name: line.name,
          available: line.availableQuantity,
          reserved: line.reservedQuantity,
          threshold: line.lowStockLevel,
          low: line.isLowStock,
        })),
    [inventory],
  );

  // One figure the header bell and the attention card agree on — computed
  // here (the only screen holding all three sources) and reported to the
  // shell through the layout's attention context.
  const attentionCount = useMemo(
    () =>
      inventory.filter((line) => line.isLowStock).length +
      counts.awaitingPayment +
      disputes.filter(
        (dispute) => dispute.status === "OPEN" || dispute.status === "UNDER_REVIEW",
      ).length,
    [inventory, counts.awaitingPayment, disputes],
  );

  useEffect(() => {
    reportAttention(attentionCount);
  }, [attentionCount, reportAttention]);

  const coverage = useMemo(() => {
    const markers: CoverageMarker[] = [];
    const byCity = new Map<string, CoverageCity>();

    for (const order of orders) {
      if (
        order.status === "CANCELLED" ||
        order.status === "DELIVERED" ||
        !order.deliveryAddress
      ) {
        continue;
      }

      const { point, approximate } = resolvePoint(
        order.deliveryAddress.lat,
        order.deliveryAddress.lng,
        order.deliveryAddress.city,
      );

      const cityKey = `${order.deliveryAddress.city} • ${
        order.deliveryAddress.province ?? "—"
      }`;
      const existing = byCity.get(cityKey);

      if (existing) {
        existing.orders += 1;
        if (!approximate) existing.pinned += 1;
      } else {
        byCity.set(cityKey, {
          city: order.deliveryAddress.city,
          province: order.deliveryAddress.province ?? "Not stated",
          orders: 1,
          pinned: approximate ? 0 : 1,
        });
      }

      if (!point) continue;

      markers.push({
        id: order.id,
        lat: point.lat,
        lng: point.lng,
        approximate,
        city: order.deliveryAddress.city,
        label: `${order.orderNumber} • ${order.user.firstName ?? "Buyer"}`,
        tone:
          order.status === "OUT_FOR_DELIVERY"
            ? "info"
            : order.status === "READY_FOR_DELIVERY"
              ? "warning"
              : "brand",
      });
    }

    return {
      markers,
      cities: [...byCity.values()].sort((a, b) => b.orders - a.orders),
    };
  }, [orders]);

  return (
    <>
      {/* The desk root keeps a back button too: history back when there is
          an in-app screen behind it, the marketplace on a deep link. */}
      <PageHeading title="Dashboard" fallback="/" />

        {/* The reference splits the screen: an analysis stack on the left, one
            tall map column on the right. Everything here is real desk data. */}
        <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-5" id="insights">
            {/* Segmented control + the one primary action. */}
            <div className="flex flex-wrap items-center gap-3">
              <div
                role="group"
                aria-label="Queue shortcuts"
                className="grid min-w-[240px] flex-1 grid-cols-2 gap-1 rounded-full border border-line bg-surface p-1"
              >
                {(
                  [
                    ["DELIVERED", "Delivered", counts.completed],
                    ["PENDING", "Pending", counts.pending],
                  ] as const
                ).map(([value, label, tally]) => (
                  <Link
                    key={value}
                    href={`/supplier/orders?status=${value}`}
                    className="flex items-center justify-between gap-2 rounded-full px-4 py-2.5 text-xs font-black text-ink-muted transition hover:bg-surface-raised hover:text-ink"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(115deg, var(--theme-elevated-surface) 0 4px, transparent 4px 9px)",
                    }}
                  >
                    {label}
                    <span className="tabular-nums">{tally}</span>
                  </Link>
                ))}
              </div>

              <Link
                href="/supplier/products/new"
                className="flex shrink-0 items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-black text-page transition hover:opacity-90"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15">
                  <PlusIcon className="h-3.5 w-3.5" />
                </span>
                New listing
              </Link>
            </div>

            {/* 2x2 stat grid beside the tall flow card. */}
            <div className="grid gap-4 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
              <div className="grid gap-4 sm:grid-cols-2">
                <KpiCard
                  label="Open orders"
                  value={counts.openOrders}
                  unit="live"
                  hint={`${counts.pending} awaiting confirmation`}
                />
                <KpiCard
                  label="Inventory lines"
                  value={inventory.length}
                  unit="listed"
                  hint={`${
                    inventory.filter((line) => line.isLowStock).length
                  } at reorder level`}
                />
                <KpiCard
                  label="Delivered value"
                  value={`R${counts.deliveredValue.toLocaleString("en-ZA", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}`}
                  unit={`${counts.completed} orders`}
                />
                <KpiCard
                  label="Needs attention"
                  value={attentionCount}
                  unit="items"
                  hint={`${counts.awaitingPayment} EFT to approve • ${
                    disputes.filter(
                      (dispute) =>
                        dispute.status === "OPEN" ||
                        dispute.status === "UNDER_REVIEW",
                    ).length
                  } open disputes`}
                />
              </div>

              <FlowCard
                title="Order flow"
                rows={[
                  {
                    label: "Awaiting EFT approval",
                    value: String(counts.awaitingPayment),
                    Icon: ShieldIcon,
                  },
                  {
                    label: "Ready for pickup",
                    value: String(counts.byStatus["READY_FOR_DELIVERY"] ?? 0),
                    Icon: BoxIcon,
                  },
                  {
                    label: "Out for delivery",
                    value: String(counts.delivery),
                    Icon: TruckIcon,
                  },
                ]}
                heroValue={String(counts.openOrders)}
                heroLabel="orders in progress"
                bars={[
                  {
                    label: "Pending",
                    value: counts.byStatus["PENDING"] ?? 0,
                    colorVar: "--theme-warning",
                  },
                  {
                    label: "Confirmed",
                    value: counts.byStatus["CONFIRMED"] ?? 0,
                    colorVar: "--theme-info",
                  },
                  {
                    label: "Packing",
                    value: counts.byStatus["PROCESSING"] ?? 0,
                    colorVar: "--theme-accent-color",
                  },
                  {
                    label: "Ready",
                    value: counts.byStatus["READY_FOR_DELIVERY"] ?? 0,
                    colorVar: "--theme-success",
                  },
                ]}
              />
            </div>

            {/* Gradient stock card + performance donut. */}
            <div className="grid gap-4 md:grid-cols-2">
              <StockHealthCard
                lines={stockLines}
                lowCount={
                  inventory.filter((line) => line.isLowStock).length
                }
                totalLines={inventory.length}
              />

              <PipelineDonut
                segments={[
                  {
                    label: "Delivered",
                    value: counts.completed,
                    colorVar: "--theme-success",
                  },
                  {
                    label: "In progress",
                    value: counts.openOrders,
                    colorVar: "--theme-warning",
                  },
                  {
                    label: "Cancelled",
                    value: counts.cancelled,
                    colorVar: "--theme-error",
                  },
                ]}
                centerValue={
                  counts.total === 0
                    ? "—"
                    : `${Math.round((counts.completed / counts.total) * 100)}%`
                }
                centerLabel="Completed"
              />
            </div>

            {/* The reference's three photo cards, filled with live demand. */}
            <div>
              <div className="flex items-center justify-between gap-3 px-1">
                <h2 className="text-sm font-black tracking-tight text-ink">
                  Open demand
                </h2>
                <Link
                  href="/supplier/demand"
                  className="text-[11px] font-black uppercase tracking-wide text-success-bright"
                >
                  Full board
                </Link>
              </div>

              {buyerRequests.length === 0 ? (
                <p className="mt-3 rounded-3xl border border-dashed border-line bg-surface px-4 py-6 text-center text-xs text-ink-muted">
                  No buyers are asking for supply right now.
                </p>
              ) : (
                <ul className="mt-3 grid gap-4 sm:grid-cols-3">
                  {buyerRequests.slice(0, 3).map((request) => {
                    const answered = myResponses.some(
                      (item) => item.request.id === request.id,
                    );

                    return (
                      <li
                        key={request.id}
                        className="flex flex-col justify-between gap-3 rounded-3xl border border-line bg-surface p-4"
                      >
                        <div>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${
                              answered
                                ? "bg-surface-raised text-ink-muted"
                                : "bg-success-soft text-success-bright"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                answered ? "bg-ink-disabled" : "bg-success"
                              }`}
                            />
                            {answered ? "Responded" : "Open"}
                          </span>
                          <p className="mt-3 line-clamp-2 text-sm font-black leading-5 text-ink">
                            {request.title}
                          </p>
                          <p className="mt-1 text-[11px] leading-5 text-ink-muted">
                            {request.quantity.toLocaleString("en-ZA")}{" "}
                            {request.unit}
                            {request.destinationCity
                              ? ` • → ${request.destinationCity}`
                              : ""}
                          </p>
                        </div>

                        {answered ? (
                          <span className="rounded-full border border-line bg-surface-raised px-3 py-2 text-xs font-black text-ink-disabled">
                            Already answered
                          </span>
                        ) : (
                          <Link
                            href={`/supplier/demand?respond=${request.id}`}
                            className="rounded-full border border-line bg-surface-raised px-3 py-2 text-xs font-black text-ink transition hover:bg-page"
                          >
                            Quote supply
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <CoveragePanel
            markers={coverage.markers}
            cities={coverage.cities}
            headline={`${counts.openOrders} open orders heading to ${
              coverage.cities.length
            } destination${coverage.cities.length === 1 ? "" : "s"}.`}
          />
        </div>

        <div id="notifications" className="mt-8 scroll-mt-28">
          <NotificationsPanel title="Notifications" />
        </div>
    </>
  );
}
