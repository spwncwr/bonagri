"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightIcon, SearchIcon } from "../../../components/mobile/icons";
import PageHeading from "../../../components/supplier/page-heading";
import { authHeaders } from "../../../lib/auth";

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

type VerifiedTransporter = {
  id: string;
  businessName: string;
  vehicleType: string | null;
  city: string | null;
  province: string | null;
  serviceProvinces: string[];
  verified: boolean;
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

function OrdersContent() {
  // Dashboard shortcuts land here as ?status=PENDING|DELIVERED. The preset is
  // read once while the queue mounts (the chips take over from there), so it
  // is folded into the state initializer instead of an effect.
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<"ALL" | OrderStatus>(() => {
    const preset = searchParams.get("status");
    return preset === "ALL" || (preset && preset in STATUS_LABELS)
      ? (preset as "ALL" | OrderStatus)
      : "ALL";
  });

  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [decidingPaymentId, setDecidingPaymentId] = useState<string | null>(null);
  const [deliveryFormOrderId, setDeliveryFormOrderId] = useState<string | null>(null);
  const [deliveryForm, setDeliveryForm] = useState({
    driverName: "",
    driverPhone: "",
    estimatedDate: "",
    trackingNumber: "",
  });
  const [error, setError] = useState("");
  // CP17: set when accepting an order is refused for lack of business
  // verification (supplier/dealer CONFIRMED gate).
  const [gateCode, setGateCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [transporters, setTransporters] = useState<VerifiedTransporter[]>([]);
  const [jobActionId, setJobActionId] = useState<string | null>(null);
  const [redispatchChoice, setRedispatchChoice] = useState<Record<string, string>>({});
  const [jobNotice, setJobNotice] = useState("");

  useEffect(() => {
    void fetch(`${API_BASE_URL}/api/transport/transporters`, {
      cache: "no-store",
      headers: authHeaders(),
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => {
        setTransporters(Array.isArray(data) ? (data as VerifiedTransporter[]) : []);
      })
      .catch(() => setTransporters([]));
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError("");

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
    deliveryDetails?: {
      driverName: string;
      driverPhone: string;
      estimatedDate: string;
      trackingNumber?: string;
    },
  ) => {
    setUpdatingOrderId(orderId);
    setError("");
    setGateCode(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders/${orderId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify(
            deliveryDetails
              ? {
                  status,
                  driverName: deliveryDetails.driverName,
                  driverPhone: deliveryDetails.driverPhone,
                  estimatedDate: deliveryDetails.estimatedDate,
                  ...(deliveryDetails.trackingNumber
                    ? { trackingNumber: deliveryDetails.trackingNumber }
                    : {}),
                }
              : { status },
          ),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        // CP17: accepting an order is gated on business verification.
        if (response.status === 403 && data?.code) {
          setGateCode(data.code);
        }

        throw new Error(data?.message ?? "Unable to update order");
      }

      if (deliveryDetails) {
        setDeliveryFormOrderId(null);
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

  // CP14: delivery-job lifecycle — publish/unpublish on the transporter
  // claim board, and re-dispatch a FAILED delivery (to a specific verified
  // transporter or back to the open board / self-delivery).
  const deliveryJobAction = async (
    orderId: string,
    action: "publish" | "unpublish" | "redispatch",
    transporterId?: string,
  ) => {
    setJobActionId(orderId);
    setError("");
    setJobNotice("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders/${orderId}/delivery/${
          action === "redispatch" ? "re-dispatch" : "publish"
        }`,
        {
          method: action === "unpublish" ? "DELETE" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          ...(action === "redispatch"
            ? { body: JSON.stringify(transporterId ? { transporterId } : {}) }
            : {}),
        },
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          (data as { message?: string } | null)?.message ??
            "Delivery job action failed",
        );
      }

      setJobNotice(
        action === "publish"
          ? "Delivery job published — verified transporters covering the province have been notified."
          : action === "unpublish"
            ? "Delivery job removed from the claim board."
            : transporterId
              ? "Delivery re-dispatched to the chosen transporter."
              : "Delivery returned to the open board — re-publish it or deliver it yourself.",
      );
      setRedispatchChoice((choices) => {
        const next = { ...choices };
        delete next[orderId];
        return next;
      });
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delivery job action failed");
    } finally {
      setJobActionId(null);
    }
  };

  // CP11: verify or reject the buyer's recorded manual EFT evidence. This
  // updates the payment only — the order advances through updateStatus.
  const decidePayment = async (
    orderId: string,
    status: "PAID" | "FAILED",
  ) => {
    setDecidingPaymentId(orderId);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders/${orderId}/payment`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({ status }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message ?? "Unable to update the payment");
      }

      await loadOrders();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update the payment",
      );
    } finally {
      setDecidingPaymentId(null);
    }
  };

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return orders.filter((order) => {
      if (filter !== "ALL" && order.status !== filter) return false;
      if (!needle) return true;

      const haystack = [
        order.orderNumber,
        `${order.user.firstName} ${order.user.lastName}`,
        order.user.email,
        order.deliveryAddress.city,
        order.deliveryAddress.addressLine1,
        order.delivery?.driverName ?? "",
        order.delivery?.trackingNumber ?? "",
        order.delivery?.transporter?.businessName ?? "",
        ...order.items.map((item) => item.productName),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(needle);
    });
  }, [filter, orders, search]);

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

  return (
    <>
      <PageHeading
        title="Order queue"
        description="Move each order through the BonAgri fulfilment lifecycle."
        fallback="/supplier"
        actions={
          <label className="relative flex w-full items-center sm:w-72">
            <SearchIcon className="pointer-events-none absolute left-3 h-4 w-4 text-ink-faint" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search orders, buyers, products..."
              aria-label="Search the order queue"
              className="w-full rounded-full border border-line bg-field py-2.5 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-ink-disabled focus:border-line-strong"
            />
          </label>
        }
      />
      <section className="mt-5 rounded-3xl border border-line bg-surface p-4 sm:p-5">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
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
              aria-pressed={filter === value}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                filter === value
                  ? "border-transparent bg-brand text-brand-ink"
                  : "border-line bg-surface-raised text-ink-muted hover:bg-page hover:text-ink"
              }`}
            >
              {label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
                  filter === value
                    ? "bg-black/15"
                    : "bg-surface text-ink-faint"
                }`}
              >
                {value === "ALL"
                  ? orders.length
                  : (counts.byStatus[value] ?? 0)}
              </span>
            </button>
          ))}
        </div>

        {gateCode === "BUSINESS_VERIFICATION_REQUIRED" && error ? (
          <div
            role="alert"
            className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <p className="font-black">
              Business verification needed to accept orders
            </p>
            <p className="mt-1 leading-6">{error}</p>
            <Link
              href="/supplier/verification"
              className="mt-2 inline-block rounded-lg bg-[#17633a] px-3 py-1.5 text-xs font-black text-white transition hover:bg-[#12512f]"
            >
              Open Verification Centre
            </Link>
          </div>
        ) : error ? (
          <div
            role="alert"
            className="mt-5 rounded-2xl border border-danger-soft bg-danger-soft px-4 py-3 text-sm text-danger-bright"
          >
            {error}
          </div>
        ) : null}

        {jobNotice && (
          <div className="mt-5 rounded-2xl border border-success-soft bg-success-soft px-4 py-3 text-sm text-success-bright">
            {jobNotice}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-sm text-ink-muted">
            Loading supplier orders...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-medium text-ink-soft">
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
              const collectingDelivery = nextStatus === "OUT_FOR_DELIVERY";
              // CP14: a claimed delivery hands pickup/DELIVERED to the
              // transporter — the supplier's own status buttons step aside.
              const lockedToTransporter = Boolean(
                order.delivery?.transporterId,
              );

              return (
                <article
                  key={order.id}
                  className="rounded-3xl border border-line bg-page p-4 sm:p-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-black tracking-tight text-ink">
                          {order.orderNumber}
                        </h3>

                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[order.status]}`}
                        >
                          {STATUS_LABELS[order.status]}
                        </span>
                      </div>

                      <p className="mt-1 text-xs text-ink-muted">
                        {formatDate(order.createdAt)}
                      </p>
                    </div>

                    <div className="min-w-0 text-left lg:text-right">
                      <p className="text-xs text-ink-muted">Order total</p>
                      <p className="text-lg font-black tabular-nums text-ink">
                        {money(order.total)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-5 lg:grid-cols-[1.3fr_1fr_1fr]">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                        Products
                      </p>

                      <div className="mt-2 space-y-2">
                        {order.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3 py-3"
                          >
                            <div className="min-w-0">
                              <p className="break-words text-sm font-medium">
                                {item.productName}
                              </p>
                              <p className="text-xs text-ink-muted">
                                {item.quantity} {item.product.unit} ×{" "}
                                {money(item.unitPrice)}
                              </p>
                            </div>

                            <p className="shrink-0 text-sm font-semibold tabular-nums">
                              {money(item.lineTotal)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                        Buyer
                      </p>

                      <div className="mt-2 text-sm">
                        <p className="font-medium break-words">
                          {order.user.firstName} {order.user.lastName}
                        </p>
                        <p className="mt-1 break-all text-ink-muted">
                          {order.user.email}
                        </p>
                        {order.user.phone && (
                          <p className="mt-1 text-ink-muted">
                            {order.user.phone}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                        Delivery
                      </p>

                      <div className="mt-2 text-sm">
                        {order.deliveryAddress.label && (
                          <p className="font-medium break-words">
                            {order.deliveryAddress.label}
                          </p>
                        )}
                        <p className="break-words">
                          {order.deliveryAddress.addressLine1}
                        </p>
                        {order.deliveryAddress.addressLine2 && (
                          <p className="break-words">
                            {order.deliveryAddress.addressLine2}
                          </p>
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

                  {/* Delivery tracking (CP12) */}
                  {order.delivery?.driverName ? (
                    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Delivery tracking
                      </p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            order.delivery.status === "DELIVERED"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-blue-200 bg-blue-50 text-blue-700"
                          }`}
                        >
                          {order.delivery.status === "DELIVERED"
                            ? "Delivered"
                            : "On the way"}
                        </span>
                        <span className="text-slate-600">
                          {order.delivery.driverName}
                          {order.delivery.trackingNumber
                            ? ` · ${order.delivery.trackingNumber}`
                            : ""}
                          {order.delivery.estimatedDate
                            ? ` · expected ${new Date(
                                order.delivery.estimatedDate,
                              ).toLocaleDateString("en-ZA", {
                                day: "2-digit",
                                month: "short",
                              })}`
                            : ""}
                        </span>
                      </p>
                      {order.delivery.deliveredAt ? (
                        <p className="mt-1 text-xs text-slate-500">
                          Delivered {formatDate(order.delivery.deliveredAt)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Delivery job board (CP14) */}
                  {order.delivery &&
                  order.status !== "DELIVERED" &&
                  order.status !== "CANCELLED" ? (
                    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Transporter job
                      </p>

                      {lockedToTransporter ? (
                        <>
                          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                order.delivery.status === "FAILED"
                                  ? "border-red-200 bg-red-50 text-red-700"
                                  : order.delivery.status === "DELIVERED"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-indigo-200 bg-indigo-50 text-indigo-700"
                              }`}
                            >
                              {order.delivery.status === "ASSIGNED"
                                ? "Assigned"
                                : order.delivery.status === "PICKED_UP"
                                  ? "Picked up"
                                  : order.delivery.status === "IN_TRANSIT"
                                    ? "In transit"
                                    : order.delivery.status === "FAILED"
                                      ? "Failed"
                                      : order.delivery.status}
                            </span>
                            <span className="text-slate-600">
                              With{" "}
                              <span className="font-semibold">
                                {order.delivery.transporter
                                  ?.businessName ?? "the assigned transporter"}
                              </span>{" "}
                              since {formatDate(order.delivery.updatedAt)}
                            </span>
                          </p>
                          <p className="mt-1.5 text-xs text-slate-500">
                            The transporter confirms pickup, transit and
                            delivery from their own hub — you will see each
                            step here.
                          </p>

                          {order.delivery.status === "FAILED" &&
                          order.delivery.failedReason ? (
                            <p className="mt-2 text-xs font-semibold text-red-700">
                              Failure reason: {order.delivery.failedReason}
                            </p>
                          ) : null}

                          {/* Re-dispatch loop (FAILED only) */}
                          {order.delivery.status === "FAILED" ? (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <select
                                value={redispatchChoice[order.id] ?? ""}
                                onChange={(event) =>
                                  setRedispatchChoice((choices) => ({
                                    ...choices,
                                    [order.id]: event.target.value,
                                  }))
                                }
                                className="rounded-xl border-slate-200 bg-white px-3 py-2 text-sm"
                              >
                                <option value="">
                                  Re-dispatch to...
                                </option>
                                {transporters.map((transporter) => (
                                  <option
                                    key={transporter.id}
                                    value={transporter.id}
                                  >
                                    {transporter.businessName}
                                    {transporter.province
                                      ? ` (${transporter.province})`
                                      : ""}
                                  </option>
                                ))}
                                <option value="board">
                                  Back to open board (self-delivery later)
                                </option>
                              </select>
                              <button
                                type="button"
                                disabled={
                                  jobActionId === order.id ||
                                  !redispatchChoice[order.id]
                                }
                                onClick={() =>
                                  void deliveryJobAction(
                                    order.id,
                                    "redispatch",
                                    redispatchChoice[order.id] === "board"
                                      ? undefined
                                      : redispatchChoice[order.id],
                                  )
                                }
                                className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {jobActionId === order.id
                                  ? "Saving..."
                                  : "Re-dispatch"}
                              </button>
                              {transporters.length === 0 ? (
                                <span className="text-xs text-slate-500">
                                  No verified transporters yet — send it back
                                  to the board or deliver it yourself.
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </>
                      ) : order.status === "READY_FOR_DELIVERY" &&
                        order.delivery.status === "PENDING" ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm">
                          {order.delivery.publishedAt ? (
                            <>
                              <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700">
                                On the claim board
                              </span>
                              <span className="text-xs text-slate-500">
                                Published {formatDate(order.delivery.publishedAt)} —
                                transporters covering{" "}
                                {order.deliveryAddress.province ??
                                  "your province"}{" "}
                                can claim it.
                              </span>
                              <button
                                type="button"
                                disabled={jobActionId === order.id}
                                onClick={() =>
                                  void deliveryJobAction(order.id, "unpublish")
                                }
                                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                              >
                                {jobActionId === order.id
                                  ? "Working..."
                                  : "Unpublish"}
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-slate-500">
                                Self-deliver with the form below, or publish
                                the job to verified transporters.
                              </span>
                              <button
                                type="button"
                                disabled={jobActionId === order.id}
                                onClick={() =>
                                  void deliveryJobAction(order.id, "publish")
                                }
                                className="rounded-xl bg-[#17633a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f4d2b] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {jobActionId === order.id
                                  ? "Publishing..."
                                  : "Publish to transporters"}
                              </button>
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Manual EFT payment (CP11) */}
                  {order.payment ? (
                    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                            Manual EFT payment
                          </p>
                          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                order.payment.status === "PAID"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : order.payment.status === "FAILED"
                                    ? "border-red-200 bg-red-50 text-red-700"
                                    : "border-amber-200 bg-amber-50 text-amber-700"
                              }`}
                            >
                              {order.payment.status === "PAID"
                                ? "Verified"
                                : order.payment.status === "FAILED"
                                  ? "Rejected"
                                  : "Awaiting check"}
                            </span>
                            <span className="text-slate-600">
                              R{order.payment.amount} · ref{" "}
                              <span className="font-semibold">
                                {order.payment.transactionRef}
                              </span>
                            </span>
                          </p>
                          {order.payment.paidAt ? (
                            <p className="mt-1 text-xs text-slate-500">
                              Verified {formatDate(order.payment.paidAt)}
                            </p>
                          ) : null}
                        </div>

                        {order.payment.status === "PENDING" ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={decidingPaymentId === order.id}
                              onClick={() =>
                                void decidePayment(order.id, "PAID")
                              }
                              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {decidingPaymentId === order.id
                                ? "Saving..."
                                : "Verify payment"}
                            </button>
                            <button
                              type="button"
                              disabled={decidingPaymentId === order.id}
                              onClick={() =>
                                void decidePayment(order.id, "FAILED")
                              }
                              className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Reject reference
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {order.invoice ? (
                    <div className="mt-4">
                      <Link
                        href={`/orders/${order.id}/invoice`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 transition hover:text-emerald-800"
                      >
                        Invoice {order.invoice.invoiceNumber} — open
                        printable view
                        <ArrowRightIcon
                          className="h-4 w-4"
                          strokeWidth={2.2}
                        />
                      </Link>
                    </div>
                  ) : null}

                  {(nextStatus || order.status === "PENDING") && (
                    <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      {lockedToTransporter && nextStatus ? (
                        <p className="text-xs text-slate-500">
                          With{" "}
                          <span className="font-semibold text-slate-700">
                            {order.delivery?.transporter?.businessName ??
                              "the assigned transporter"}
                          </span>{" "}
                          since{" "}
                          {formatDate(order.delivery?.updatedAt ?? order.createdAt)}{" "}
                          — they drive the rest of this order from their hub.
                        </p>
                      ) : nextStatus ? (
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
                        {nextStatus && !collectingDelivery && !lockedToTransporter && (
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

                        {collectingDelivery && !lockedToTransporter ? (
                          <button
                            type="button"
                            disabled={updating}
                            onClick={() => {
                              setDeliveryFormOrderId(
                                deliveryFormOrderId === order.id
                                  ? null
                                  : order.id,
                              );
                              setDeliveryForm({
                                driverName: "",
                                driverPhone: "",
                                estimatedDate: "",
                                trackingNumber: "",
                              });
                              setError("");
                            }}
                            className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deliveryFormOrderId === order.id
                              ? "Close form"
                              : "Mark out for delivery"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {/* CP12: driver details collected on the OUT_FOR_DELIVERY
                      step instead of a bare status flip. */}
                  {collectingDelivery && deliveryFormOrderId === order.id ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Delivery details
                      </p>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="text-sm text-slate-600">
                          Driver name *
                          <input
                            type="text"
                            value={deliveryForm.driverName}
                            onChange={(event) =>
                              setDeliveryForm((form) => ({
                                ...form,
                                driverName: event.target.value,
                              }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          />
                        </label>

                        <label className="text-sm text-slate-600">
                          Driver phone *
                          <input
                            type="tel"
                            value={deliveryForm.driverPhone}
                            onChange={(event) =>
                              setDeliveryForm((form) => ({
                                ...form,
                                driverPhone: event.target.value,
                              }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          />
                        </label>

                        <label className="text-sm text-slate-600">
                          Expected delivery date *
                          <input
                            type="date"
                            value={deliveryForm.estimatedDate}
                            onChange={(event) =>
                              setDeliveryForm((form) => ({
                                ...form,
                                estimatedDate: event.target.value,
                              }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          />
                        </label>

                        <label className="text-sm text-slate-600">
                          Tracking number (optional)
                          <input
                            type="text"
                            value={deliveryForm.trackingNumber}
                            onChange={(event) =>
                              setDeliveryForm((form) => ({
                                ...form,
                                trackingNumber: event.target.value,
                              }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          />
                        </label>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          disabled={updating}
                          onClick={() => {
                            if (
                              !deliveryForm.driverName.trim() ||
                              !deliveryForm.driverPhone.trim() ||
                              !deliveryForm.estimatedDate
                            ) {
                              setError(
                                "Driver name, phone and expected date are required to send an order out for delivery",
                              );
                              return;
                            }

                            void updateStatus(order.id, "OUT_FOR_DELIVERY", {
                              driverName: deliveryForm.driverName.trim(),
                              driverPhone: deliveryForm.driverPhone.trim(),
                              estimatedDate: deliveryForm.estimatedDate,
                              trackingNumber:
                                deliveryForm.trackingNumber.trim(),
                            });
                          }}
                          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {updating ? "Saving..." : "Send out for delivery"}
                        </button>

                        <span className="text-xs text-slate-500">
                          The buyer sees the driver and tracking details on
                          their order.
                        </span>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersContent />
    </Suspense>
  );
}
