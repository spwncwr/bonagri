"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AuthGuard from "../../components/auth/auth-guard";
import { authHeaders } from "../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type Job = {
  orderId: string;
  orderNumber: string;
  pickupCity: string | null;
  supplierBusinessName: string | null;
  dropoffCity: string | null;
  dropoffProvince: string | null;
  itemCount: number;
  publishedAt: string | null;
};

type DeliveryOrder = {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  items: { quantity: number; product: { name: string } }[];
  deliveryAddress: {
    recipientName: string;
    addressLine1: string;
    city: string;
    province: string | null;
  };
  user: { firstName: string; lastName: string; phone: string | null };
};

type Delivery = {
  orderId: string;
  status: "ASSIGNED" | "PICKED_UP" | "IN_TRANSIT" | "DELIVERED" | "FAILED";
  pickedUpAt: string | null;
  deliveredAt: string | null;
  failedReason: string | null;
  failedAt: string | null;
  order: DeliveryOrder;
};

const statusChip: Record<Delivery["status"], { label: string; cls: string }> = {
  ASSIGNED: { label: "Claimed — pick up next", cls: "bg-amber-100 text-amber-800" },
  PICKED_UP: { label: "Picked up", cls: "bg-sky-100 text-sky-800" },
  IN_TRANSIT: { label: "In transit", cls: "bg-indigo-100 text-indigo-800" },
  DELIVERED: { label: "Delivered", cls: "bg-emerald-100 text-emerald-800" },
  FAILED: { label: "Failed", cls: "bg-red-100 text-red-700" },
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function TransportHub() {
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
        `You claimed order ${job.orderNumber}. Pickup details are in My Deliveries.`,
      );
      await refreshAll();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Could not claim this job");
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
      await refreshAll();
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Could not record the failure",
      );
    } finally {
      setFailing(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f6f0]">
      <header className="sticky top-0 z-20 border-b border-[#dfe3d9] bg-[#f7f6f0]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#17633a] text-lg font-black text-white">
              B
            </div>
            <div>
              <div className="text-xl font-black tracking-tight">BonAgri</div>
              <div className="text-[8px] font-bold tracking-[0.25em] text-[#778178]">
                TRANSPORT HUB
              </div>
            </div>
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-[#ccd5ca] px-4 py-2.5 text-sm font-bold"
          >
            Marketplace
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-xs font-black uppercase tracking-[0.2em] text-[#17633a]">
          Delivery jobs
        </div>
        <h1 className="mt-2 text-3xl font-black tracking-tight">
          Claim a job. Move the goods. Close the loop.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#637067]">
          Jobs published by suppliers in the provinces you serve appear on the
          board below. Full pickup and dropoff details unlock once you claim a
          job.
        </p>

        {notice ? (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {notice}
          </div>
        ) : null}

        {pageError ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {pageError}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-10 flex items-center gap-3 text-sm font-bold text-[#637067]">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#ccd5ca] border-t-[#17633a]" />
            Loading your transport hub...
          </div>
        ) : null}

        {!loading && unverified ? (
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="font-black text-amber-900">
              Your transporter profile is being verified
            </h2>
            <p className="mt-2 text-sm leading-6 text-amber-800">
              The BonAgri team verifies transporter profiles before jobs become
              visible. You will be notified as soon as you are verified.
            </p>
          </div>
        ) : null}

        {!loading && !unverified ? (
          <>
            {/* Claim board */}
            <section className="mt-10">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xl font-black">Open jobs</h2>
                <span className="text-sm font-bold text-[#637067]">
                  {jobs.length} available
                </span>
              </div>

              {jobs.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-[#ccd5ca] bg-white p-8 text-center text-sm text-[#637067]">
                  No open jobs in your service provinces right now. New jobs
                  appear here the moment suppliers publish them.
                </div>
              ) : (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {jobs.map((job) => (
                    <article
                      key={job.orderId}
                      className="rounded-2xl border border-[#d7dfd4] bg-white p-5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black tracking-wide text-[#17633a]">
                          {job.orderNumber}
                        </span>
                        <span className="text-xs font-bold text-[#7b867d]">
                          {job.publishedAt
                            ? `Published ${formatDate(job.publishedAt)}`
                            : ""}
                        </span>
                      </div>

                      <div className="mt-3 flex items-center gap-2 text-sm font-bold text-[#2c3a2f]">
                        <span>{job.pickupCity ?? "Pickup TBC"}</span>
                        <span className="text-[#17633a]">→</span>
                        <span>{job.dropoffCity ?? "Dropoff TBC"}</span>
                      </div>

                      <div className="mt-2 text-xs font-semibold text-[#637067]">
                        {job.supplierBusinessName ?? "Supplier"} ·{" "}
                        {job.itemCount} item{job.itemCount === 1 ? "" : "s"}
                        {job.dropoffProvince ? ` · ${job.dropoffProvince}` : ""}
                      </div>

                      <button
                        type="button"
                        disabled={claimingId === job.orderId}
                        onClick={() => void claimJob(job)}
                        className="mt-4 w-full rounded-lg bg-[#17633a] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#0f4d2b] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {claimingId === job.orderId
                          ? "Claiming..."
                          : "Claim this job"}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* My deliveries */}
            <section className="mt-12">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xl font-black">My deliveries</h2>
                <span className="text-sm font-bold text-[#637067]">
                  {active.length} active
                </span>
              </div>

              {active.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-[#ccd5ca] bg-white p-8 text-center text-sm text-[#637067]">
                  Nothing in progress. Claim a job above to get started.
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  {active.map((delivery) => {
                    const chip = statusChip[delivery.status];
                    const busy = actingId === delivery.orderId;

                    return (
                      <article
                        key={delivery.orderId}
                        className="rounded-2xl border border-[#d7dfd4] bg-white p-5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <span className="text-xs font-black tracking-wide text-[#17633a]">
                              {delivery.order.orderNumber}
                            </span>
                            <span
                              className={`ml-3 rounded-full px-2.5 py-1 text-[11px] font-black ${chip.cls}`}
                            >
                              {chip.label}
                            </span>
                          </div>
                          <span className="text-xs font-bold text-[#7b867d]">
                            Placed {formatDate(delivery.order.createdAt)}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
                          <div className="rounded-xl bg-[#f2f4ef] p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.15em] text-[#7b867d]">
                              Pickup
                            </div>
                            <div className="mt-1 font-bold text-[#2c3a2f]">
                              {delivery.order.deliveryAddress.recipientName}
                            </div>
                            <div className="text-[#637067]">
                              {delivery.order.deliveryAddress.addressLine1},{" "}
                              {delivery.order.deliveryAddress.city}
                            </div>
                            <div className="text-[#637067]">
                              Buyer: {delivery.order.user.firstName}{" "}
                              {delivery.order.user.lastName}
                              {delivery.order.user.phone
                                ? ` · ${delivery.order.user.phone}`
                                : ""}
                            </div>
                          </div>

                          <div className="rounded-xl bg-[#f2f4ef] p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.15em] text-[#7b867d]">
                              Goods
                            </div>
                            <ul className="mt-1 space-y-0.5 text-[#637067]">
                              {delivery.order.items.map((item, index) => (
                                <li key={index}>
                                  {item.quantity} × {item.product.name}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {delivery.status === "ASSIGNED" ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void deliveryAction(delivery, "pickup")
                                }
                                className="rounded-lg bg-[#17633a] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0f4d2b] disabled:opacity-50"
                              >
                                {busy ? "Saving..." : "Confirm pickup"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setFailTarget(delivery);
                                  setFailReason("");
                                }}
                                className="rounded-lg border border-red-200 px-4 py-2 text-xs font-bold text-red-700 transition hover:bg-red-50"
                              >
                                Report pickup failure
                              </button>
                            </>
                          ) : null}

                          {delivery.status === "PICKED_UP" ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void deliveryAction(delivery, "transit")
                                }
                                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                              >
                                Start transit
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void deliveryAction(delivery, "complete")
                                }
                                className="rounded-lg bg-[#17633a] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0f4d2b] disabled:opacity-50"
                              >
                                Mark delivered
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setFailTarget(delivery);
                                  setFailReason("");
                                }}
                                className="rounded-lg border border-red-200 px-4 py-2 text-xs font-bold text-red-700 transition hover:bg-red-50"
                              >
                                Report delivery failure
                              </button>
                            </>
                          ) : null}

                          {delivery.status === "IN_TRANSIT" ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void deliveryAction(delivery, "complete")
                                }
                                className="rounded-lg bg-[#17633a] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0f4d2b] disabled:opacity-50"
                              >
                                Mark delivered
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setFailTarget(delivery);
                                  setFailReason("");
                                }}
                                className="rounded-lg border border-red-200 px-4 py-2 text-xs font-bold text-red-700 transition hover:bg-red-50"
                              >
                                Report delivery failure
                              </button>
                            </>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {/* History */}
            {history.length > 0 ? (
              <section className="mt-12">
                <h2 className="text-xl font-black">History</h2>
                <div className="mt-4 space-y-3">
                  {history.map((delivery) => {
                    const chip = statusChip[delivery.status];

                    return (
                      <article
                        key={delivery.orderId}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e2e7de] bg-white/70 p-4"
                      >
                        <div className="text-sm">
                          <span className="font-black text-[#17633a]">
                            {delivery.order.orderNumber}
                          </span>
                          <span className="ml-3 text-[#637067]">
                            {delivery.order.deliveryAddress.city}
                          </span>
                          {delivery.status === "FAILED" &&
                          delivery.failedReason ? (
                            <span className="ml-3 text-xs text-red-600">
                              {delivery.failedReason}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-black ${chip.cls}`}
                          >
                            {chip.label}
                          </span>
                          <span className="text-xs font-bold text-[#7b867d]">
                            {formatDate(
                              delivery.deliveredAt ??
                                delivery.failedAt ??
                                delivery.pickedUpAt,
                            )}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      {/* Failure dialog */}
      {failTarget ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-6">
          <form
            onSubmit={(event) => void submitFailure(event)}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h3 className="text-lg font-black">
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
                className="rounded-lg border border-[#ccd5ca] px-4 py-2 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={failing}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {failing ? "Saving..." : "Record failure"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

export default function TransportPage() {
  return (
    <AuthGuard allowedRoles={["TRANSPORTER"]}>
      <TransportHub />
    </AuthGuard>
  );
}
