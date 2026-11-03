"use client";

import Link from "next/link";
import AuthGuard from "../../components/auth/auth-guard";
import NotificationsPanel from "../../components/notifications/notifications-panel";

import SupplierShell from "../../components/supplier/supplier-shell";
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
import {
  ArrowRightIcon,
  BoxIcon,
  PlusIcon,
  ShieldIcon,
  TruckIcon,
} from "../../components/mobile/icons";
import { resolvePoint } from "../../lib/geo";
import { authHeaders, fetchCurrentUser, type UserRole } from "../../lib/auth";
import { useCallback, useEffect, useMemo, useState } from "react";

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

// CP14: verified transporters offered in the post-failure re-dispatch
// dropdown (mirrors GET /api/transport/transporters).
type VerifiedTransporter = {
  id: string;
  businessName: string;
  vehicleType: string | null;
  city: string | null;
  province: string | null;
  serviceProvinces: string[];
  verified: boolean;
};

export default function SupplierPage() {
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
  const [search, setSearch] = useState("");
  const [inventory, setInventory] = useState<SupplierInventoryLine[]>([]);
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
  // CP14: delivery-job publish/unpublish/re-dispatch
  const [transporters, setTransporters] = useState<VerifiedTransporter[]>([]);
  const [jobActionId, setJobActionId] = useState<string | null>(null);
  const [redispatchChoice, setRedispatchChoice] = useState<
    Record<string, string>
  >({});
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

  // One figure the header bell, the attention card and the queue all agree on.
  const attentionCount = useMemo(
    () =>
      inventory.filter((line) => line.isLowStock).length +
      counts.awaitingPayment +
      disputes.filter(
        (dispute) => dispute.status === "OPEN" || dispute.status === "UNDER_REVIEW",
      ).length,
    [inventory, counts.awaitingPayment, disputes],
  );

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
    <AuthGuard allowedRoles={["SUPPLIER", "AGRO_DEALER"]}>
      <SupplierShell
        vendorRole={vendorRole}
        query={search}
        onQueryChange={setSearch}
        attention={attentionCount}
      >
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
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => {
                      setFilter(filter === value ? "ALL" : value);
                      document
                        .getElementById("queue")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className={`flex items-center justify-between gap-2 rounded-full px-4 py-2.5 text-xs font-black transition ${
                      filter === value
                        ? "bg-brand text-brand-ink"
                        : "text-ink-muted hover:bg-surface-raised hover:text-ink"
                    }`}
                    style={
                      filter === value
                        ? undefined
                        : {
                            backgroundImage:
                              "repeating-linear-gradient(115deg, var(--theme-elevated-surface) 0 4px, transparent 4px 9px)",
                          }
                    }
                  >
                    {label}
                    <span className="tabular-nums">{tally}</span>
                  </button>
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
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById("demand")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  className="text-[11px] font-black uppercase tracking-wide text-success-bright"
                >
                  Full board
                </button>
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

                        <button
                          type="button"
                          disabled={answered}
                          onClick={() => {
                            setRespondError("");
                            setRespondNotice("");
                            setRespondingTo(answered ? null : request.id);
                            document
                              .getElementById("demand")
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                          }}
                          className="rounded-full border border-line bg-surface-raised px-3 py-2 text-xs font-black text-ink transition hover:bg-page disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {answered ? "Already answered" : "Quote supply"}
                        </button>
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

        <section
          id="queue"
          className="mt-5 scroll-mt-28 rounded-3xl border border-line bg-surface p-4 sm:p-5"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-black tracking-tight text-ink">
                Order queue
              </h2>
              <p className="mt-1 text-sm leading-6 text-ink-muted">
                Move each order through the BonAgri fulfilment lifecycle.
              </p>
            </div>

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
          </div>

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-2xl border border-danger-soft bg-danger-soft px-4 py-3 text-sm text-danger-bright"
            >
              {error}
            </div>
          )}

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

        <section
          id="disputes"
          className="mt-5 scroll-mt-28 rounded-3xl border border-line bg-surface p-4 sm:p-5"
        >
          <h2 className="text-lg font-black tracking-tight text-ink">
            Disputes
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            Disputes buyers have opened on orders containing your products. The
            BonAgri team reviews each one with the order timeline as evidence.
          </p>

          {disputes.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-line bg-page p-8 text-center text-sm text-ink-muted">
              No disputes on your orders. Keep fulfilling on time and this list
              will stay empty.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {disputes.map((dispute) => (
                <article
                  key={dispute.id}
                  className="rounded-2xl border border-line bg-page p-4 sm:p-5"
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

        <section
          id="demand"
          className="mt-5 scroll-mt-28 rounded-3xl border border-line bg-surface p-4 sm:p-5"
        >
          <h2 className="text-lg font-black tracking-tight text-ink">
            Buyer requests
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
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

        <section
          id="responses"
          className="mt-5 scroll-mt-28 rounded-3xl border border-line bg-surface p-4 sm:p-5"
        >
          <h2 className="text-lg font-black tracking-tight text-ink">
            My responses
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
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

        <div id="notifications" className="mt-8 scroll-mt-28">
          <NotificationsPanel title="Notifications" />
        </div>
      </SupplierShell>
    </AuthGuard>
  );
}
