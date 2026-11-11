"use client";

// CP17: admin verification review centre — the ONLY screen (via the ONLY
// endpoints) that can move a business application to VERIFIED. Queue with
// filters and pagination, full detail with private document viewing and the
// audit trail, and the five validated actions (reasons are mandatory for
// reject / request-info / suspend — the applicant is shown that text).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminRowsSkeleton } from "../../../components/admin/admin-ui";
import {
  actOnApplication,
  getAdminApplication,
  getAdminApplications,
  getAdminStats,
  getDocumentUrl,
  VerificationApiError,
  type AdminApplicationDetail,
  type AdminApplicationListItem,
  type AdminVerificationAction,
  type AdminVerificationStats,
  type VerificationStatus,
} from "../../../lib/verification";

const STATUS_STYLES: Record<VerificationStatus, string> = {
  NOT_STARTED: "bg-slate-100 text-slate-700",
  PENDING: "bg-amber-100 text-amber-800",
  UNDER_REVIEW: "bg-sky-100 text-sky-800",
  ACTION_REQUIRED: "bg-orange-100 text-orange-800",
  VERIFIED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
  SUSPENDED: "bg-rose-200 text-rose-900",
};

const STATUS_LABELS: Record<VerificationStatus, string> = {
  NOT_STARTED: "Not started",
  PENDING: "Awaiting review",
  UNDER_REVIEW: "Under review",
  ACTION_REQUIRED: "Changes requested",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
};

// Which actions are legal from which state mirrors the service's
// ADMIN_TRANSITIONS table — buttons appear only where they can succeed.
const ACTIONS_BY_STATUS: Record<VerificationStatus, AdminVerificationAction[]> =
  {
    NOT_STARTED: [],
    PENDING: ["start_review", "approve", "reject", "request_info"],
    UNDER_REVIEW: ["approve", "reject", "request_info"],
    ACTION_REQUIRED: ["approve", "reject"],
    VERIFIED: ["suspend"],
    REJECTED: [],
    SUSPENDED: ["approve"],
  };

const ACTION_LABELS: Record<AdminVerificationAction, string> = {
  start_review: "Start review",
  approve: "Approve",
  reject: "Reject",
  request_info: "Request changes",
  suspend: "Suspend",
};

// The applicant reads reason text for these — the form insists on it.
const REASON_REQUIRED: AdminVerificationAction[] = [
  "reject",
  "request_info",
  "suspend",
];

const PAGE_SIZE = 20;

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(value: number | null) {
  if (!value) return "";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminVerificationPage() {
  const [stats, setStats] = useState<AdminVerificationStats | null>(null);
  const [items, setItems] = useState<AdminApplicationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [statusFilter, setStatusFilter] = useState<VerificationStatus | "">("");
  const [roleFilter, setRoleFilter] = useState<"" | "SUPPLIER" | "AGRO_DEALER">(
    "",
  );
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminApplicationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [pendingAction, setPendingAction] =
    useState<AdminVerificationAction | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [queue, headline] = await Promise.all([
        getAdminApplications({
          status: statusFilter || undefined,
          role: roleFilter || undefined,
          q: query || undefined,
          skip,
          take: PAGE_SIZE,
        }),
        getAdminStats(),
      ]);
      setItems(queue.items);
      setTotal(queue.total);
      setStats(headline);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load the verification queue.",
      );
    } finally {
      setLoading(false);
    }
  }, [statusFilter, roleFilter, query, skip]);

  useEffect(() => {
    // load() is async: queue/stats state updates only run after the awaited
    // requests resolve, never synchronously in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Search submits explicitly (Enter / button) so typing does not refetch;
  // each filter handler resets `skip` alongside its own state update.

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    setReason("");
    setNotes("");
    setPendingAction(null);
    setError("");
    try {
      setDetail(await getAdminApplication(id));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load that application.",
      );
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function perform(action: AdminVerificationAction) {
    if (!selectedId) return;
    if (
      REASON_REQUIRED.includes(action) &&
      (reason.trim().length < 5 || reason.trim().length > 2000)
    ) {
      setError("A meaningful reason is required — the applicant sees it.");
      return;
    }

    setActing(true);
    setError("");
    setNotice("");

    try {
      const updated = await actOnApplication(
        selectedId,
        action,
        REASON_REQUIRED.includes(action) ? reason.trim() : undefined,
        notes.trim() || undefined,
      );
      setNotice(
        action === "approve"
          ? "Approved — the business is verified and the badge is live."
          : action === "start_review"
            ? "Moved to under review."
            : `${ACTION_LABELS[action]} recorded — the applicant was notified.`,
      );
      setReason("");
      setNotes("");
      setPendingAction(null);
      setDetail(await getAdminApplication(selectedId));
      await load();
      void updated;
    } catch (actError) {
      setError(
        actError instanceof VerificationApiError
          ? actError.message
          : actError instanceof Error
            ? actError.message
            : "That action could not be applied.",
      );
    } finally {
      setActing(false);
    }
  }

  async function openDocument(documentId: string) {
    if (!selectedId) return;
    try {
      const { url } = await getDocumentUrl(selectedId, documentId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "Could not open that document.",
      );
    }
  }

  const availableActions = useMemo(
    () => (detail ? ACTIONS_BY_STATUS[detail.status] : []),
    [detail],
  );

  const firstPage = skip === 0;
  const lastPage = skip + PAGE_SIZE >= total;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Business verification
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Suppliers and agro-dealers submit documents here for manual review.
          Approval grants the Business verified badge and unlocks publishing
          and order acceptance — it can never be self-served.
        </p>
      </div>

      {/* Queue-level stats — where the backlog sits at a glance. */}
      {stats ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {(
            Object.keys(STATUS_LABELS) as VerificationStatus[]
          ).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => {
                setStatusFilter(statusFilter === status ? "" : status);
                setSkip(0);
              }}
              className={`rounded-xl border px-3 py-2.5 text-left transition ${
                statusFilter === status
                  ? "border-emerald-600 bg-emerald-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {STATUS_LABELS[status]}
              </p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {stats.applications[status]}
              </p>
            </button>
          ))}
        </div>
      ) : null}

      {stats ? (
        <p className="mb-4 text-xs text-slate-500">
          {stats.phoneVerified} buyer account
          {stats.phoneVerified === 1 ? "" : "s"} phone-verified ·{" "}
          {stats.accounts.VERIFIED} business
          {stats.accounts.VERIFIED === 1 ? "" : "es"} verified platform-wide
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
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

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="vv-status"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-400"
          >
            Status
          </label>
          <select
            id="vv-status"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as VerificationStatus | "");
              setSkip(0);
            }}
            className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
          >
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABELS) as VerificationStatus[])
              .filter((status) => status !== "NOT_STARTED")
              .map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="vv-role"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-400"
          >
            Role
          </label>
          <select
            id="vv-role"
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter(
                event.target.value as "" | "SUPPLIER" | "AGRO_DEALER",
              );
              setSkip(0);
            }}
            className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
          >
            <option value="">All vendors</option>
            <option value="SUPPLIER">Suppliers</option>
            <option value="AGRO_DEALER">Agro-dealers</option>
          </select>
        </div>

        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSkip(0);
            setQuery(search.trim());
          }}
        >
          <div>
            <label
              htmlFor="vv-search"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-400"
            >
              Search
            </label>
            <input
              id="vv-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Business name, email or id"
              className="mt-1 w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Filter
          </button>
        </form>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* Queue */}
        <div>
          {loading ? (
            <AdminRowsSkeleton
              rows={4}
              label="Loading applications..."
              rowHeight="h-24"
            />
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600">
              No applications match these filters.
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((application) => (
                <li key={application.id}>
                  <button
                    type="button"
                    onClick={() => void openDetail(application.id)}
                    className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:bg-slate-50 ${
                      selectedId === application.id
                        ? "border-emerald-600 ring-1 ring-emerald-600"
                        : "border-slate-200"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        {application.businessName}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[application.status]}`}
                      >
                        {STATUS_LABELS[application.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {application.applicant.name} (
                      {application.applicant.email}) ·{" "}
                      {application.role === "AGRO_DEALER"
                        ? "Agro-dealer"
                        : "Supplier"}{" "}
                      · {application.documentCount} document
                      {application.documentCount === 1 ? "" : "s"} · submitted{" "}
                      {formatDate(application.submittedAt)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Account status:{" "}
                      <span className="font-semibold text-slate-600">
                        {STATUS_LABELS[application.applicant.businessStatus]}
                      </span>
                      {application.reviewedBy
                        ? ` · last reviewed by ${application.reviewedBy}`
                        : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Pagination — the queue is unbounded, so paging is mandatory. */}
          {total > PAGE_SIZE ? (
            <div className="mt-4 flex items-center justify-between text-sm">
              <button
                type="button"
                disabled={firstPage}
                onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-slate-500">
                {skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {total}
              </span>
              <button
                type="button"
                disabled={lastPage}
                onClick={() => setSkip(skip + PAGE_SIZE)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          ) : null}
        </div>

        {/* Detail pane */}
        <div>
          {detailLoading ? (
            <AdminRowsSkeleton
              rows={2}
              label="Loading application..."
              rowHeight="h-40"
            />
          ) : detail ? (
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">
                  {detail.businessName}
                </h2>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[detail.status]}`}
                >
                  {STATUS_LABELS[detail.status]}
                </span>
              </div>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Applicant</dt>
                  <dd className="text-right font-medium text-slate-800">
                    {detail.applicant.name}
                    <br />
                    <span className="text-xs font-normal text-slate-500">
                      {detail.applicant.email}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Role</dt>
                  <dd className="font-medium text-slate-800">
                    {detail.role === "AGRO_DEALER" ? "Agro-dealer" : "Supplier"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Registration no.</dt>
                  <dd className="font-medium text-slate-800">
                    {detail.registrationNumber || "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Contact</dt>
                  <dd className="text-right font-medium text-slate-800">
                    {detail.contactPhone}
                    {detail.contactEmail ? (
                      <>
                        <br />
                        <span className="text-xs font-normal text-slate-500">
                          {detail.contactEmail}
                        </span>
                      </>
                    ) : null}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Address</dt>
                  <dd className="text-right font-medium text-slate-800">
                    {detail.physicalAddress}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Representative</dt>
                  <dd className="font-medium text-slate-800">
                    {detail.representativeName}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Account phone</dt>
                  <dd className="font-medium text-slate-800">
                    {detail.applicant.phone || "—"}
                    {detail.applicant.phoneVerifiedAt ? " (verified)" : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Submitted</dt>
                  <dd className="font-medium text-slate-800">
                    {formatDate(detail.submittedAt)}
                  </dd>
                </div>
              </dl>

              {/* Documents — private assets behind signed short-lived links. */}
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Documents
                </h3>
                <ul className="mt-2 space-y-2">
                  {detail.documents.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {doc.fileName ?? doc.kind.replaceAll("_", " ")}
                        </p>
                        <p className="text-xs text-slate-500">
                          {doc.kind.replaceAll("_", " ").toLowerCase()}
                          {doc.sizeBytes ? ` · ${formatBytes(doc.sizeBytes)}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void openDocument(doc.id)}
                        className="shrink-0 text-xs font-semibold text-emerald-700 underline-offset-4 hover:underline"
                      >
                        Open
                      </button>
                    </li>
                  ))}
                  {detail.documents.length === 0 ? (
                    <li className="text-sm text-slate-500">
                      No documents attached.
                    </li>
                  ) : null}
                </ul>
              </div>

              {/* Previous decision context */}
              {detail.infoRequest ? (
                <p className="mt-3 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                  Changes requested: {detail.infoRequest}
                </p>
              ) : null}
              {detail.rejectionReason ? (
                <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  Rejected: {detail.rejectionReason}
                </p>
              ) : null}

              {/* Actions */}
              {availableActions.length > 0 ? (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap gap-2">
                    {availableActions.map((action) => (
                      <button
                        key={action}
                        type="button"
                        disabled={acting}
                        onClick={() => {
                          setPendingAction(action);
                          setError("");
                        }}
                        className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          action === "approve"
                            ? "bg-emerald-700 text-white hover:bg-emerald-800"
                            : action === "start_review"
                              ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              : "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                        }`}
                      >
                        {ACTION_LABELS[action]}
                      </button>
                    ))}
                  </div>

                  {pendingAction ? (
                    <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-700">
                        {ACTION_LABELS[pendingAction]} — {detail.businessName}
                      </p>

                      <div>
                        <label
                          htmlFor="vv-reason"
                          className="block text-xs font-semibold uppercase tracking-wider text-slate-400"
                        >
                          {REASON_REQUIRED.includes(pendingAction)
                            ? "Reason shown to the applicant (required)"
                            : "Reason (optional)"}
                        </label>
                        <textarea
                          id="vv-reason"
                          rows={3}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          placeholder="e.g. The CIPC certificate photo is unreadable — please re-upload a clear scan."
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="vv-notes"
                          className="block text-xs font-semibold uppercase tracking-wider text-slate-400"
                        >
                          Internal notes (never shown to the applicant)
                        </label>
                        <textarea
                          id="vv-notes"
                          rows={2}
                          value={notes}
                          onChange={(event) => setNotes(event.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={acting}
                          onClick={() => void perform(pendingAction)}
                          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {acting ? "Working..." : "Confirm"}
                        </button>
                        <button
                          type="button"
                          disabled={acting}
                          onClick={() => setPendingAction(null)}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Audit trail */}
              {detail.history.length > 0 ? (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    History
                  </h3>
                  <ol className="mt-2 space-y-1.5">
                    {detail.history.map((entry) => (
                      <li
                        key={entry.id}
                        className="text-xs leading-5 text-slate-600"
                      >
                        <span className="font-semibold text-slate-800">
                          {entry.action.replace(/_/g, " ").toLowerCase()}
                        </span>{" "}
                        by {entry.actor} · {formatDate(entry.createdAt)}
                        {entry.fromStatus && entry.toStatus ? (
                          <span className="text-slate-400">
                            {" "}
                            ({entry.fromStatus} → {entry.toStatus})
                          </span>
                        ) : null}
                        {entry.reason ? ` — ${entry.reason}` : ""}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </article>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              Select an application to review its documents and history.
              <br />
              <Link
                href="/admin/applications"
                className="mt-2 inline-block font-semibold text-emerald-700 underline-offset-4 hover:underline"
              >
                Seller applications (vendor onboarding) are next door →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
