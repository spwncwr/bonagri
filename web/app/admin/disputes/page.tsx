"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type DisputeStatus =
  | "OPEN"
  | "UNDER_REVIEW"
  | "RESOLVED"
  | "REJECTED";

type AdminDispute = {
  id: string;
  reason: string;
  description: string;
  status: DisputeStatus;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  order: {
    id: string;
    orderNumber: string;
    status: string;
    total: string;
    createdAt: string;
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string | null;
    };
    items: Array<{ productName: string; quantity: number }>;
    history: Array<{
      id: string;
      fromStatus: string | null;
      toStatus: string;
      actorRole: string | null;
      createdAt: string;
    }>;
  };
  openedBy: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  resolvedBy: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
};

const FILTERS = ["ALL", "OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"] as const;

const STATUS_STYLES: Record<DisputeStatus, string> = {
  OPEN: "bg-amber-100 text-amber-800",
  UNDER_REVIEW: "bg-blue-100 text-blue-700",
  RESOLVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-700",
};

const REASON_LABELS: Record<string, string> = {
  NOT_DELIVERED: "Not delivered",
  WRONG_ITEM: "Wrong item received",
  DAMAGED: "Damaged goods",
  OTHER: "Other",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actingId, setActingId] = useState<string | null>(null);

  const loadDisputes = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/disputes`, {
        cache: "no-store",
        headers: authHeaders(),
      });

      if (!response.ok) {
        throw new Error("Unable to load disputes");
      }

      setDisputes((await response.json()) as AdminDispute[]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load disputes",
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/disputes`, {
          cache: "no-store",
          headers: authHeaders(),
        });

        if (!response.ok) {
          throw new Error("Unable to load disputes");
        }

        const data = (await response.json()) as AdminDispute[];

        if (!cancelled) {
          setDisputes(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load disputes",
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

  async function updateDispute(
    disputeId: string,
    status: "UNDER_REVIEW" | "RESOLVED" | "REJECTED",
  ) {
    const closing = status !== "UNDER_REVIEW";
    const note = (notes[disputeId] ?? "").trim();

    if (closing && !note) {
      setError("A resolution note is required to close a dispute.");
      return;
    }

    setActingId(disputeId);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/disputes/${disputeId}`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            closing
              ? { status, resolutionNote: note }
              : { status },
          ),
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
            : "Unable to update this dispute",
        );
      }

      const result = (await response.json()) as {
        dispute: AdminDispute;
        emailSent: boolean;
      };

      if (closing) {
        setNotice(
          result.emailSent
            ? `Dispute closed — resolution email sent to ${result.dispute.order.user.email}.`
            : "Dispute closed — the resolution email could not be sent (check SMTP configuration).",
        );
        setNotes((current) => ({ ...current, [disputeId]: "" }));
      }

      await loadDisputes();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update this dispute",
      );
    } finally {
      setActingId(null);
    }
  }

  const visible =
    filter === "ALL"
      ? disputes
      : disputes.filter((dispute) => dispute.status === filter);

  const counts = Object.fromEntries(
    FILTERS.map((value) => [
      value,
      value === "ALL"
        ? disputes.length
        : disputes.filter((dispute) => dispute.status === value).length,
    ]),
  ) as Record<(typeof FILTERS)[number], number>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Disputes</h1>
        <p className="mt-1 text-sm text-slate-500">
          Buyer disputes with the full order timeline as evidence. Resolve each
          one with a note — the buyer is emailed the outcome.
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

      {notice ? (
        <div
          role="status"
          className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filter === value
                ? "bg-emerald-700 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {value === "ALL" ? "All" : value.replaceAll("_", " ")} ({counts[value]})
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading disputes...</p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-600">
          No disputes in this view.
        </div>
      ) : (
        <div className="space-y-6">
          {visible.map((dispute) => {
            const acting = actingId === dispute.id;
            const canTransition =
              dispute.status === "OPEN" || dispute.status === "UNDER_REVIEW";

            return (
              <article
                key={dispute.id}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/orders/${dispute.order.id}`}
                        className="text-lg font-semibold hover:underline"
                      >
                        {dispute.order.orderNumber}
                      </Link>

                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[dispute.status]}`}
                      >
                        {dispute.status.replaceAll("_", " ")}
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-slate-500">
                      Opened {formatDate(dispute.createdAt)} by{" "}
                      {dispute.openedBy.firstName} {dispute.openedBy.lastName}{" "}
                      ({dispute.openedBy.email}) · Order status:{" "}
                      {dispute.order.status.replaceAll("_", " ")}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-xs text-slate-500">Order total</p>
                    <p className="text-lg font-semibold">
                      R{dispute.order.total}
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {REASON_LABELS[dispute.reason] ?? dispute.reason}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">
                    {dispute.description}
                  </p>
                </div>

                {/* Evidence: order items + status history */}
                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Items
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-700">
                      {dispute.order.items.map((item, index) => (
                        <li key={index}>
                          {item.productName} × {item.quantity}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Order timeline (evidence)
                    </p>
                    <ol className="mt-2 space-y-1 text-xs text-slate-600">
                      {dispute.order.history.map((entry) => (
                        <li key={entry.id} className="flex justify-between gap-3">
                          <span>
                            <span className="font-semibold text-slate-800">
                              {entry.toStatus.replaceAll("_", " ")}
                            </span>
                            {entry.actorRole ? ` · ${entry.actorRole}` : ""}
                          </span>
                          <span className="shrink-0 text-slate-400">
                            {formatDate(entry.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                {canTransition ? (
                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <label
                      htmlFor={`note-${dispute.id}`}
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-400"
                    >
                      Resolution note (required to close)
                    </label>
                    <textarea
                      id={`note-${dispute.id}`}
                      rows={3}
                      value={notes[dispute.id] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [dispute.id]: event.target.value,
                        }))
                      }
                      placeholder="e.g. Refund issued for the two damaged crates; supplier advised on packaging."
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                    />

                    <div className="mt-3 flex flex-wrap gap-2">
                      {dispute.status === "OPEN" ? (
                        <button
                          type="button"
                          disabled={acting}
                          onClick={() =>
                            void updateDispute(dispute.id, "UNDER_REVIEW")
                          }
                          className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {acting ? "Working..." : "Mark under review"}
                        </button>
                      ) : null}

                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void updateDispute(dispute.id, "RESOLVED")}
                        className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Resolve
                      </button>

                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void updateDispute(dispute.id, "REJECTED")}
                        className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Resolution
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-slate-700">
                      {dispute.resolutionNote ?? "No note recorded."}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {dispute.status === "RESOLVED" ? "Resolved" : "Rejected"}
                      {dispute.resolvedAt
                        ? ` ${formatDate(dispute.resolvedAt)}`
                        : ""}
                      {dispute.resolvedBy
                        ? ` by ${dispute.resolvedBy.firstName} ${dispute.resolvedBy.lastName}`
                        : ""}
                    </p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
