"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import AuthGuard from "../../../components/auth/auth-guard";
import {
  authHeaders,
  fetchCurrentUser,
  type UserRole,
} from "../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type OrderHistoryEntry = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorRole: string | null;
  note: string | null;
  createdAt: string;
};

type OrderDispute = {
  id: string;
  reason: string;
  description: string;
  status: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: string;
  deliveryFee: string;
  total: string;
  notes: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    product: {
      unit: string;
      supplier: { businessName: string };
    };
  }>;
  deliveryAddress: {
    label: string;
    recipientName: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    province: string | null;
    postalCode: string | null;
    country: string;
  };
  history: OrderHistoryEntry[];
  dispute: OrderDispute | null;
};

const DISPUTE_ELIGIBLE_STATUSES = ["OUT_FOR_DELIVERY", "DELIVERED"];

const DISPUTE_REASON_LABELS: Record<string, string> = {
  NOT_DELIVERED: "Not delivered",
  WRONG_ITEM: "Wrong item received",
  DAMAGED: "Damaged goods",
  OTHER: "Other",
};

function disputeBadgeClass(status: string) {
  if (status === "RESOLVED") {
    return "bg-[#e5f1e4] text-[#17633a]";
  }

  if (status === "REJECTED") {
    return "bg-red-100 text-red-700";
  }

  if (status === "UNDER_REVIEW") {
    return "bg-blue-100 text-blue-700";
  }

  return "bg-amber-100 text-amber-700";
}

const STEP_LABELS: Record<string, string> = {
  PENDING: "Order placed",
  CONFIRMED: "Confirmed by supplier",
  PROCESSING: "Preparing your order",
  READY_FOR_DELIVERY: "Ready for delivery",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

const NEXT_HINTS: Record<string, string> = {
  PENDING: "Waiting for the supplier to confirm your order.",
  CONFIRMED: "The supplier is preparing your order.",
  PROCESSING: "Your order is being prepared for dispatch.",
  READY_FOR_DELIVERY: "Your order is packed and awaiting delivery.",
  OUT_FOR_DELIVERY: "Your order is on its way to you.",
};

const ACTOR_LABELS: Record<string, string> = {
  BUYER: "You",
  SUPPLIER: "Supplier",
  AGRO_DEALER: "Dealer",
  ADMIN: "BonAgri team",
};

function statusBadgeClass(status: string) {
  if (status === "CANCELLED") {
    return "bg-red-100 text-red-700";
  }

  if (status === "DELIVERED") {
    return "bg-[#e5f1e4] text-[#17633a]";
  }

  return "bg-amber-100 text-amber-700";
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const [viewerRole, setViewerRole] = useState<UserRole | null>(null);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState("DAMAGED");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const [disputeError, setDisputeError] = useState("");

  useEffect(() => {
    let cancelled = false;

    void fetchCurrentUser().then((user) => {
      if (!cancelled) {
        setViewerRole(user?.role ?? null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/orders/${orderId}`, {
          cache: "no-store",
          headers: authHeaders(),
        });

        if (response.status === 404) {
          throw new Error("Order not found — it may belong to another account.");
        }

        if (!response.ok) {
          throw new Error("Unable to load this order");
        }

        const data = (await response.json()) as OrderDetail;

        if (!cancelled) {
          setOrder(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load this order",
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
  }, [orderId]);

  async function cancelOrder() {
    if (!order) return;

    const confirmed = window.confirm(
      `Cancel order ${order.orderNumber}? Reserved stock will be released.`,
    );

    if (!confirmed) return;

    setCancelling(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders/${order.id}/status`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "CANCELLED" }),
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
            : "Unable to cancel this order",
        );
      }

      setOrder((await response.json()) as OrderDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to cancel this order");
    } finally {
      setCancelling(false);
    }
  }

  async function submitDispute() {
    if (!order) return;

    setSubmittingDispute(true);
    setDisputeError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders/${order.id}/dispute`,
        {
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reason: disputeReason,
            description: disputeDescription,
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
            : "Unable to open this dispute",
        );
      }

      const dispute = (await response.json()) as OrderDispute;

      setOrder((current) =>
        current ? { ...current, dispute } : current,
      );
      setShowDisputeForm(false);
      setDisputeDescription("");
    } catch (err) {
      setDisputeError(
        err instanceof Error ? err.message : "Unable to open this dispute",
      );
    } finally {
      setSubmittingDispute(false);
    }
  }

  return (
    <AuthGuard allowedRoles={["BUYER", "ADMIN"]}>
      <main className="min-h-screen bg-[#f6f7f2] text-slate-900">
        <header className="border-b border-[#dce2d9] bg-white">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#17633a]">
                BonAgri
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Order details
              </h1>
              {order ? (
                <p className="mt-1 text-sm text-[#69756c]">
                  {order.orderNumber} ·{" "}
                  {new Date(order.createdAt).toLocaleDateString("en-ZA", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              ) : null}
            </div>

            <Link
              href="/#orders"
              className="rounded-xl border border-[#dce2d9] bg-white px-4 py-2 text-sm font-medium text-[#344238] transition hover:bg-[#f7f8f4]"
            >
              ← My Orders
            </Link>
          </div>
        </header>

        <div className="mx-auto max-w-4xl px-6 py-8">
          {error ? (
            <div
              role="alert"
              className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-[#69756c]">Loading order...</p>
          ) : !order ? (
            <div className="rounded-2xl border border-dashed border-[#dce2d9] bg-white p-12 text-center">
              <h2 className="text-lg font-semibold">Order not found</h2>
              <p className="mt-2 text-sm text-[#69756c]">
                This order does not belong to your account.
              </p>
              <Link
                href="/"
                className="mt-6 inline-block rounded-xl bg-[#17633a] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#12512f]"
              >
                Back to marketplace
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Status + timeline */}
              <section className="rounded-2xl border border-[#dce2d9] bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${statusBadgeClass(
                        order.status,
                      )}`}
                    >
                      {order.status.replaceAll("_", " ")}
                    </span>

                    {NEXT_HINTS[order.status] ? (
                      <span className="text-sm text-[#69756c]">
                        {NEXT_HINTS[order.status]}
                      </span>
                    ) : null}
                  </div>

                  {order.status === "PENDING" ? (
                    <button
                      type="button"
                      disabled={cancelling}
                      onClick={() => void cancelOrder()}
                      className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {cancelling ? "Cancelling..." : "Cancel order"}
                    </button>
                  ) : null}
                </div>

                <ol className="mt-6 space-y-0">
                  {order.history.map((entry, index) => {
                    const isLast = index === order.history.length - 1;
                    const isCancelled = entry.toStatus === "CANCELLED";

                    return (
                      <li key={entry.id} className="relative flex gap-4 pb-6">
                        {!isLast ? (
                          <span
                            aria-hidden
                            className="absolute left-[7px] top-4 h-full w-px bg-[#dce2d9]"
                          />
                        ) : null}

                        <span
                          aria-hidden
                          className={`mt-1 h-4 w-4 shrink-0 rounded-full ring-4 ring-white ${
                            isCancelled
                              ? "bg-red-500"
                              : isLast
                                ? "bg-[#17633a]"
                                : "bg-[#9dbfa9]"
                          }`}
                        />

                        <div className="-mt-0.5">
                          <p className="text-sm font-bold text-[#17251b]">
                            {STEP_LABELS[entry.toStatus] ?? entry.toStatus}
                          </p>

                          <p className="text-xs text-[#69756c]">
                            {new Date(entry.createdAt).toLocaleString("en-ZA", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {" · "}
                            {entry.actorRole
                              ? ACTOR_LABELS[entry.actorRole] ?? entry.actorRole
                              : "System"}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>

              {/* Dispute (CP5) */}
              {order.dispute ||
              (viewerRole === "BUYER" &&
                DISPUTE_ELIGIBLE_STATUSES.includes(order.status)) ? (
                <section className="rounded-2xl border border-[#dce2d9] bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#7b867d]">
                      Dispute
                    </h2>

                    {order.dispute ? (
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${disputeBadgeClass(
                          order.dispute.status,
                        )}`}
                      >
                        {order.dispute.status.replaceAll("_", " ")}
                      </span>
                    ) : null}
                  </div>

                  {order.dispute ? (
                    <div className="mt-4 space-y-3 text-sm">
                      <div>
                        <p className="font-bold text-[#17251b]">
                          {DISPUTE_REASON_LABELS[order.dispute.reason] ??
                            order.dispute.reason}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-[#344238]">
                          {order.dispute.description}
                        </p>
                        <p className="mt-1 text-xs text-[#69756c]">
                          Opened{" "}
                          {new Date(order.dispute.createdAt).toLocaleString(
                            "en-ZA",
                            {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </p>
                      </div>

                      {order.dispute.resolutionNote ? (
                        <div className="rounded-xl border border-[#dce2d9] bg-[#f6f7f2] p-4">
                          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#7b867d]">
                            Resolution note
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-[#17251b]">
                            {order.dispute.resolutionNote}
                          </p>
                          {order.dispute.resolvedAt ? (
                            <p className="mt-2 text-xs text-[#69756c]">
                              {order.dispute.status === "RESOLVED"
                                ? "Resolved"
                                : "Closed"}{" "}
                              {new Date(order.dispute.resolvedAt).toLocaleString(
                                "en-ZA",
                                {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs text-[#69756c]">
                          The BonAgri team is reviewing this dispute — you will
                          receive an email with the outcome.
                        </p>
                      )}
                    </div>
                  ) : viewerRole === "BUYER" && !showDisputeForm ? (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-[#69756c]">
                        Something wrong with this order? You can raise a formal
                        dispute for the BonAgri team to review.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowDisputeForm(true)}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
                      >
                        Open a dispute
                      </button>
                    </div>
                  ) : null}

                  {viewerRole === "BUYER" && showDisputeForm && !order.dispute ? (
                    <div className="mt-4 space-y-3">
                      {disputeError ? (
                        <div
                          role="alert"
                          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                        >
                          {disputeError}
                        </div>
                      ) : null}

                      <div>
                        <label
                          htmlFor="dispute-reason"
                          className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                        >
                          What went wrong?
                        </label>
                        <select
                          id="dispute-reason"
                          value={disputeReason}
                          onChange={(event) => setDisputeReason(event.target.value)}
                          className="mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none"
                        >
                          {Object.entries(DISPUTE_REASON_LABELS).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="dispute-description"
                          className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                        >
                          Describe the issue
                        </label>
                        <textarea
                          id="dispute-description"
                          rows={4}
                          value={disputeDescription}
                          onChange={(event) =>
                            setDisputeDescription(event.target.value)
                          }
                          placeholder="e.g. Two crates arrived bruised and unusable..."
                          className="mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none"
                        />
                      </div>

                      <div className="flex gap-3">
                        <button
                          type="button"
                          disabled={submittingDispute || !disputeDescription.trim()}
                          onClick={() => void submitDispute()}
                          className="rounded-xl bg-[#17633a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#12512f] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {submittingDispute ? "Submitting..." : "Submit dispute"}
                        </button>
                        <button
                          type="button"
                          disabled={submittingDispute}
                          onClick={() => {
                            setShowDisputeForm(false);
                            setDisputeError("");
                          }}
                          className="rounded-xl border border-[#dce2d9] px-5 py-2.5 text-sm font-medium text-[#344238] transition hover:bg-[#f7f8f4]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {/* Items + totals */}
              <section className="rounded-2xl border border-[#dce2d9] bg-white p-6 shadow-sm">
                <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#7b867d]">
                  Items
                </h2>

                <div className="mt-4 space-y-3">
                  {order.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 text-sm"
                    >
                      <div>
                        <p className="font-bold text-[#344238]">
                          {item.productName}
                        </p>
                        <p className="text-xs text-[#69756c]">
                          Sold by {item.product.supplier.businessName}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="font-bold text-[#17251b]">
                          R{item.lineTotal}
                        </p>
                        <p className="text-xs text-[#69756c]">
                          {item.quantity} × R{item.unitPrice} /{" "}
                          {item.product.unit}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 space-y-1 border-t border-[#e3e8e0] pt-4 text-sm">
                  <div className="flex justify-between text-[#69756c]">
                    <span>Subtotal</span>
                    <span>R{order.subtotal}</span>
                  </div>
                  <div className="flex justify-between text-[#69756c]">
                    <span>Delivery fee</span>
                    <span>R{order.deliveryFee}</span>
                  </div>
                  <div className="flex justify-between text-base font-black text-[#17633a]">
                    <span>Total</span>
                    <span>R{order.total}</span>
                  </div>
                </div>
              </section>

              {/* Delivery address */}
              <section className="rounded-2xl border border-[#dce2d9] bg-white p-6 shadow-sm">
                <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#7b867d]">
                  Delivery
                </h2>

                <div className="mt-3 text-sm text-[#344238]">
                  <p className="font-bold">{order.deliveryAddress.recipientName}</p>
                  <p>{order.deliveryAddress.addressLine1}</p>
                  {order.deliveryAddress.addressLine2 ? (
                    <p>{order.deliveryAddress.addressLine2}</p>
                  ) : null}
                  <p>
                    {order.deliveryAddress.city}
                    {order.deliveryAddress.province
                      ? `, ${order.deliveryAddress.province}`
                      : ""}
                    {order.deliveryAddress.postalCode
                      ? ` ${order.deliveryAddress.postalCode}`
                      : ""}
                  </p>
                  <p className="text-[#69756c]">
                    {order.deliveryAddress.country}
                  </p>
                </div>

                <div className="mt-4">
                  <Link
                    href="/addresses"
                    className="text-sm font-medium text-[#17633a] hover:text-[#12512f]"
                  >
                    Manage your addresses →
                  </Link>
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </AuthGuard>
  );
}
