"use client";

import Link from "next/link";
import AuthGuard from "../../components/auth/auth-guard";
import NotificationsPanel from "../../components/notifications/notifications-panel";
import { authHeaders, clearAuth, fetchCurrentUser, type UserRole } from "../../lib/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

const RESPONSE_STATUS_STYLES: Record<MyResponse["status"], string> = {
  OPEN: "bg-emerald-100 text-emerald-800",
  ACCEPTED: "bg-[#e8f1e6] text-[#17633a]",
  DECLINED: "bg-slate-200 text-slate-600",
  WITHDRAWN: "bg-amber-100 text-amber-700",
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

const DISPUTE_REASON_LABELS: Record<string, string> = {
  NOT_DELIVERED: "Not delivered",
  WRONG_ITEM: "Wrong item received",
  DAMAGED: "Damaged goods",
  OTHER: "Other",
};

const DISPUTE_STATUS_STYLES: Record<VendorDispute["status"], string> = {
  OPEN: "border-amber-200 bg-amber-50 text-amber-700",
  UNDER_REVIEW: "border-blue-200 bg-blue-50 text-blue-700",
  RESOLVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  REJECTED: "border-red-200 bg-red-50 text-red-700",
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
  const router = useRouter();
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [decidingPaymentId, setDecidingPaymentId] = useState<string | null>(
    null,
  );
  const [deliveryFormOrderId, setDeliveryFormOrderId] = useState<string | null>(
    null,
  );
  const [deliveryForm, setDeliveryForm] = useState({
    driverName: "",
    driverPhone: "",
    estimatedDate: "",
    trackingNumber: "",
  });
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"ALL" | OrderStatus>("ALL");
  const [vendorRole, setVendorRole] = useState<UserRole | null>(null);
  const [disputes, setDisputes] = useState<VendorDispute[]>([]);
  const [buyerRequests, setBuyerRequests] = useState<BuyerRequest[]>([]);
  const [myResponses, setMyResponses] = useState<MyResponse[]>([]);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [respondMessage, setRespondMessage] = useState("");
  const [respondPrice, setRespondPrice] = useState("");
  const [respondUnit, setRespondUnit] = useState("");
  const [responding, setResponding] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [respondError, setRespondError] = useState("");
  const [respondNotice, setRespondNotice] = useState("");

  useEffect(() => {
    void fetchCurrentUser().then((user) => {
      setVendorRole(user?.role ?? null);
    });
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

  async function submitResponse(requestId: string) {
    setResponding(true);
    setRespondError("");
    setRespondNotice("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/product-requests/${requestId}/responses`,
        {
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: respondMessage,
            ...(respondPrice ? { quotedPrice: Number(respondPrice) } : {}),
            ...(respondUnit ? { quotedUnit: respondUnit } : {}),
          }),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;

        throw new Error(
          data?.message
            ? Array.isArray(data.message)
              ? data.message.join(", ")
              : data.message
            : "Unable to send your response",
        );
      }

      const request = buyerRequests.find((item) => item.id === requestId);
      const created = (await response.json()) as {
        id: string;
        status: MyResponse["status"];
        message: string;
        quotedPrice: string | null;
        quotedUnit: string | null;
        createdAt: string;
      };

      setMyResponses((current) => [
        {
          ...created,
          request: {
            id: requestId,
            title: request?.title ?? "Buyer request",
            quantity: request?.quantity ?? 0,
            unit: request?.unit ?? "",
            destinationCity: request?.destinationCity ?? null,
            status: "OPEN",
          },
        },
        ...current,
      ]);
      setRespondingTo(null);
      setRespondMessage("");
      setRespondPrice("");
      setRespondUnit("");
      setRespondNotice("Response sent — the buyer will see it on their request.");
    } catch (err) {
      setRespondError(
        err instanceof Error ? err.message : "Unable to send your response",
      );
    } finally {
      setResponding(false);
    }
  }

  async function withdrawResponse(responseId: string) {
    setWithdrawingId(responseId);
    setRespondError("");
    setRespondNotice("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/product-requests/responses/${responseId}`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "WITHDRAWN" }),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;

        throw new Error(
          data?.message
            ? Array.isArray(data.message)
              ? data.message.join(", ")
              : data.message
            : "Unable to withdraw your response",
        );
      }

      const updated = (await response.json()) as { id: string; status: string };

      setMyResponses((current) =>
        current.map((item) =>
          item.id === updated.id
            ? { ...item, status: "WITHDRAWN" as const }
            : item,
        ),
      );
    } catch (err) {
      setRespondError(
        err instanceof Error ? err.message : "Unable to withdraw your response",
      );
    } finally {
      setWithdrawingId(null);
    }
  }

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
    <AuthGuard allowedRoles={["SUPPLIER", "AGRO_DEALER"]}>
      <main className="min-h-screen bg-[#f6f7f2] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
              BonAgri
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {vendorRole === "AGRO_DEALER"
                ? "Agro Dealer Operations"
                : "Supplier Operations"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {vendorRole === "AGRO_DEALER"
                ? "Manage your tool and equipment orders, fulfilment and delivery readiness."
                : "Manage incoming orders, fulfilment and delivery readiness."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/supplier/products"
              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              My listings
            </Link>

            <Link
              href="/supplier/inventory"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Inventory
            </Link>

            <Link
              href="/"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Marketplace
            </Link>

            <button
              type="button"
              onClick={() => {
                clearAuth();
                router.replace("/login");
              }}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Logout
            </button>
          </div>
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
                const collectingDelivery = nextStatus === "OUT_FOR_DELIVERY";

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
                              ? ` · expected ${formatDate(order.delivery.estimatedDate)}`
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
                          className="text-sm font-medium text-emerald-700 transition hover:text-emerald-800"
                        >
                          Invoice {order.invoice.invoiceNumber} — open
                          printable view →
                        </Link>
                      </div>
                    ) : null}

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
                          {nextStatus && !collectingDelivery && (
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

                          {collectingDelivery ? (
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

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Disputes</h2>
          <p className="mt-1 text-sm text-slate-500">
            Disputes buyers have opened on orders containing your products. The
            BonAgri team reviews each one with the order timeline as evidence.
          </p>

          {disputes.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              No disputes on your orders. Keep fulfilling on time and this list
              will stay empty.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {disputes.map((dispute) => (
                <article
                  key={dispute.id}
                  className="rounded-2xl border border-slate-200 p-5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/orders/${dispute.order.id}`}
                          className="font-semibold hover:underline"
                        >
                          {dispute.order.orderNumber}
                        </Link>

                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${DISPUTE_STATUS_STYLES[dispute.status]}`}
                        >
                          {dispute.status.replaceAll("_", " ")}
                        </span>
                      </div>

                      <p className="mt-1 text-xs text-slate-500">
                        Opened {formatDate(dispute.createdAt)} by{" "}
                        {dispute.openedBy.firstName}{" "}
                        {dispute.openedBy.lastName}
                      </p>
                    </div>

                    <div className="text-left sm:text-right">
                      <p className="text-xs text-slate-500">Order total</p>
                      <p className="text-lg font-semibold">
                        {money(dispute.order.total)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      {DISPUTE_REASON_LABELS[dispute.reason] ?? dispute.reason}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-slate-700">
                      {dispute.description}
                    </p>
                  </div>

                  {dispute.resolutionNote ? (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                        Resolution note
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-emerald-900">
                        {dispute.resolutionNote}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-slate-500">
                      Awaiting review by the BonAgri team.
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[#dce2d9] bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Buyer requests</h2>
          <p className="mt-1 text-sm text-[#69756c]">
            Open demand buyers have posted. Respond with what you can supply —
            the buyer accepts the response they like best.
          </p>

          {respondError ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {respondError}
            </div>
          ) : null}

          {respondNotice ? (
            <div
              role="status"
              className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            >
              {respondNotice}
            </div>
          ) : null}

          {buyerRequests.length === 0 ? (
            <p className="mt-4 text-sm text-[#69756c]">
              No open buyer requests right now.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {buyerRequests.map((request) => {
                const hasResponded = myResponses.some(
                  (item) => item.request.id === request.id,
                );

                return (
                  <li
                    key={request.id}
                    className="rounded-xl border border-[#e3e8e1] bg-[#fafbf8] p-4 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{request.title}</p>
                        <p className="mt-1 text-xs text-[#69756c]">
                          {request.quantity.toLocaleString("en-ZA")}{" "}
                          {request.unit}
                          {request.category
                            ? ` • ${request.category.name}`
                            : ""}
                          {request.destinationCity
                            ? ` • → ${request.destinationCity}`
                            : ""}
                          {request.requiredBy
                            ? ` • by ${new Date(
                                request.requiredBy,
                              ).toLocaleDateString("en-ZA", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })}`
                            : ""}
                        </p>

                        {request.notes ? (
                          <p className="mt-1 text-xs text-[#7a857d]">
                            {request.notes}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {hasResponded ? (
                          <span className="rounded-full bg-[#e8f1e6] px-2.5 py-1 text-[10px] font-bold text-[#17633a]">
                            RESPONDED
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setRespondingTo(
                                respondingTo === request.id ? null : request.id,
                              );
                              setRespondError("");
                              setRespondNotice("");
                            }}
                            className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                          >
                            {respondingTo === request.id ? "Cancel" : "Respond"}
                          </button>
                        )}

                        <span className="rounded-full bg-[#e8f1e6] px-2.5 py-1 text-[10px] font-bold text-[#17633a]">
                          OPEN
                        </span>
                      </div>
                    </div>

                    {respondingTo === request.id ? (
                      <div className="mt-4 space-y-3 rounded-xl border border-[#dce2d9] bg-white p-4">
                        <div>
                          <label
                            htmlFor={`respond-message-${request.id}`}
                            className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                          >
                            What can you supply?
                          </label>
                          <textarea
                            id={`respond-message-${request.id}`}
                            rows={3}
                            value={respondMessage}
                            onChange={(event) =>
                              setRespondMessage(event.target.value)
                            }
                            placeholder="e.g. We can supply 2 tons of Grade 1 tomatoes weekly from Polokwane."
                            className="mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none"
                          />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor={`respond-price-${request.id}`}
                              className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                            >
                              Quoted price (optional)
                            </label>
                            <input
                              id={`respond-price-${request.id}`}
                              type="number"
                              min={0.01}
                              step="0.01"
                              value={respondPrice}
                              onChange={(event) =>
                                setRespondPrice(event.target.value)
                              }
                              placeholder="e.g. 12.50"
                              className="mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor={`respond-unit-${request.id}`}
                              className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                            >
                              Price unit (optional)
                            </label>
                            <input
                              id={`respond-unit-${request.id}`}
                              type="text"
                              value={respondUnit}
                              onChange={(event) =>
                                setRespondUnit(event.target.value)
                              }
                              placeholder="e.g. per kg"
                              className="mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none"
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={responding || respondMessage.trim().length === 0}
                          onClick={() => void submitResponse(request.id)}
                          className="rounded-xl bg-[#17633a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#12512f] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {responding ? "Sending..." : "Send response"}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[#dce2d9] bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">My responses</h2>
          <p className="mt-1 text-sm text-[#69756c]">
            Responses you have sent on buyer requests. Accepted responses mean
            the buyer picked you.
          </p>

          {myResponses.length === 0 ? (
            <p className="mt-4 text-sm text-[#69756c]">
              You have not responded to any buyer requests yet.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {myResponses.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-[#e3e8e1] bg-[#fafbf8] p-4 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{item.request.title}</p>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${RESPONSE_STATUS_STYLES[item.status]}`}
                        >
                          {item.status}
                        </span>
                      </div>

                      <p className="mt-1 text-xs text-[#69756c]">
                        {item.request.quantity.toLocaleString("en-ZA")}{" "}
                        {item.request.unit}
                        {item.request.destinationCity
                          ? ` • → ${item.request.destinationCity}`
                          : ""}
                        {" • "}
                        {new Date(item.createdAt).toLocaleDateString("en-ZA", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>

                      <p className="mt-1 text-xs text-[#7a857d]">
                        {item.message}
                      </p>

                      {item.quotedPrice ? (
                        <p className="mt-1 text-xs font-semibold text-[#17633a]">
                          R{" "}
                          {Number(item.quotedPrice).toLocaleString("en-ZA", {
                            minimumFractionDigits: 2,
                          })}
                          {item.quotedUnit ? ` ${item.quotedUnit}` : ""}
                        </p>
                      ) : null}
                    </div>

                    {item.status === "OPEN" ? (
                      <button
                        type="button"
                        disabled={withdrawingId === item.id}
                        onClick={() => void withdrawResponse(item.id)}
                        className="rounded-lg border border-[#e5d9c5] bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {withdrawingId === item.id
                          ? "Working..."
                          : "Withdraw"}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-8">
          <NotificationsPanel title="Notifications" />
        </div>
      </div>
      </main>
    </AuthGuard>
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
