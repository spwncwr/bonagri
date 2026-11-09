"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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

function money(value: number | string) {
  return `R${Number(value).toFixed(2)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function DisputesContent() {
  const [disputes, setDisputes] = useState<VendorDispute[]>([]);

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

  return (
    <>
      <PageHeading
        title="Disputes"
        description="Disputes buyers have opened on orders containing your products. The BonAgri team reviews each one with the order timeline as evidence."
        fallback="/supplier"
      />
      <section className="mt-5 rounded-3xl border border-line bg-surface p-4 sm:p-5">

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
    </>
  );
}

export default function DisputesPage() {
  return <DisputesContent />;
}
