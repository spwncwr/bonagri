"use client";

import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type SellerApplication = {
  id: string;
  desiredRole: "SUPPLIER" | "AGRO_DEALER";
  businessName: string;
  message: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
  reviewedBy: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
};

const STATUS_STYLES: Record<SellerApplication["status"], string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-700",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AdminApplicationsPage() {
  const [applications, setApplications] = useState<SellerApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/seller-applications`,
          {
            cache: "no-store",
            headers: authHeaders(),
          },
        );

        if (!response.ok) {
          throw new Error("Unable to load seller applications");
        }

        const data = (await response.json()) as SellerApplication[];

        if (!cancelled) {
          setApplications(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load seller applications",
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

  const reload = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/api/seller-applications`, {
      cache: "no-store",
      headers: authHeaders(),
    });

    if (response.ok) {
      setApplications((await response.json()) as SellerApplication[]);
    }
  }, []);

  async function decide(
    applicationId: string,
    status: "APPROVED" | "REJECTED",
  ) {
    const note = (notes[applicationId] ?? "").trim();

    setActingId(applicationId);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/seller-applications/${applicationId}`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(note ? { status, note } : { status }),
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
            : "Unable to review this application",
        );
      }

      const decided = (await response.json()) as SellerApplication;

      setNotice(
        status === "APPROVED"
          ? `${decided.businessName} is now a ${decided.desiredRole === "AGRO_DEALER" ? "dealer" : "supplier"} — the applicant was notified.`
          : `${decided.businessName} was rejected — the applicant was notified.`,
      );
      setNotes((current) => ({ ...current, [applicationId]: "" }));
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to review this application",
      );
    } finally {
      setActingId(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Seller applications
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Approving an application creates the vendor profile and promotes the
          account — exactly once. The applicant is notified by email and in
          their notifications.
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

      {loading ? (
        <p className="text-sm text-slate-500">Loading applications...</p>
      ) : applications.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-600">
          No seller applications yet. Buyers can apply from the
          &quot;Sell on BonAgri&quot; page.
        </div>
      ) : (
        <div className="space-y-6">
          {applications.map((application) => {
            const acting = actingId === application.id;
            const pending = application.status === "PENDING";

            return (
              <article
                key={application.id}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">
                        {application.businessName}
                      </h2>

                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[application.status]}`}
                      >
                        {application.status}
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-slate-500">
                      {application.user.firstName} {application.user.lastName}{" "}
                      ({application.user.email}) · current role:{" "}
                      {application.user.role.replaceAll("_", " ")} · applying
                      as:{" "}
                      <span className="font-semibold text-slate-700">
                        {application.desiredRole === "AGRO_DEALER"
                          ? "Agro dealer"
                          : "Supplier"}
                      </span>{" "}
                      · {formatDate(application.createdAt)}
                    </p>
                  </div>
                </div>

                {application.message ? (
                  <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                    <p className="whitespace-pre-wrap">{application.message}</p>
                  </div>
                ) : null}

                {pending ? (
                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <label
                      htmlFor={`note-${application.id}`}
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-400"
                    >
                      Note to the applicant (optional)
                    </label>
                    <textarea
                      id={`note-${application.id}`}
                      rows={2}
                      value={notes[application.id] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [application.id]: event.target.value,
                        }))
                      }
                      placeholder="e.g. Welcome aboard — list your first products from the vendor hub."
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                    />

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void decide(application.id, "APPROVED")}
                        className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {acting ? "Working..." : "Approve"}
                      </button>

                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void decide(application.id, "REJECTED")}
                        className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-slate-500">
                    {application.status === "APPROVED" ? "Approved" : "Rejected"}
                    {application.reviewedAt
                      ? ` ${formatDate(application.reviewedAt)}`
                      : ""}
                    {application.reviewedBy
                      ? ` by ${application.reviewedBy.firstName} ${application.reviewedBy.lastName}`
                      : ""}
                    {application.reviewNote
                      ? ` — ${application.reviewNote}`
                      : ""}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
