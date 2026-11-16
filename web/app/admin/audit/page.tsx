"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "../../../lib/auth";
import { AdminRowsSkeleton } from "../../../components/admin/admin-ui";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type AuditEntry = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  actor: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
};

type AuditFeed = {
  items: AuditEntry[];
  actions: string[];
};

// One hue per action family so the feed is scannable without parsing names.
const ACTION_STYLES: Record<string, string> = {
  USER: "bg-sky-100 text-sky-800",
  SUPPLIER: "bg-teal-100 text-teal-800",
  TRANSPORTER: "bg-teal-100 text-teal-800",
  CATEGORY: "bg-amber-100 text-amber-800",
  BANNER: "bg-amber-100 text-amber-800",
  PROMOTION: "bg-purple-100 text-purple-800",
  BROADCAST: "bg-rose-100 text-rose-800",
};

function actionStyle(action: string) {
  const family = Object.keys(ACTION_STYLES).find((prefix) =>
    action.startsWith(prefix),
  );
  return family ? ACTION_STYLES[family] : "bg-slate-100 text-slate-700";
}

// Metadata is free-form JSON — flatten the scalar entries into a readable
// one-liner and drop nested structures (the row already names the target).
function metadataPreview(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "";
  return Object.entries(metadata)
    .filter(([, value]) => typeof value !== "object" || value === null)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

export default function AdminAuditPage() {
  const [feed, setFeed] = useState<AuditFeed>({ items: [], actions: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (action) params.set("action", action);
        if (actor.trim()) params.set("actor", actor.trim());
        params.set("limit", "100");

        const response = await fetch(
          `${API_BASE_URL}/api/admin/audit?${params.toString()}`,
          { cache: "no-store", headers: authHeaders() },
        );

        if (!response.ok) {
          throw new Error("Unable to load the audit trail");
        }

        const data = (await response.json()) as AuditFeed;
        if (!cancelled) {
          setFeed(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load the audit trail",
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
  }, [action, actor]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit trail</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every dangerous admin action, who performed it and when — recorded
            in the same transaction as the change itself.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            placeholder="Filter by actor email..."
            className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />

          <select
            value={action}
            onChange={(event) => setAction(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          >
            <option value="">All actions</option>
            {feed.actions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <AdminRowsSkeleton rows={6} label="Loading audit trail..." rowHeight="h-20" />
      ) : feed.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-600">
          No audit entries match this filter.
        </div>
      ) : (
        <div className="space-y-2.5">
          {feed.items.map((entry) => (
            <div
              key={entry.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${actionStyle(entry.action)}`}
                  >
                    {entry.action.replaceAll("_", " ")}
                  </span>

                  <span className="truncate text-sm font-semibold text-slate-800">
                    {entry.actor
                      ? `${entry.actor.firstName ?? ""} ${entry.actor.lastName ?? ""}`.trim() ||
                        entry.actor.email
                      : "Unknown actor"}
                  </span>

                  <span className="truncate text-xs text-slate-500">
                    {entry.actor?.email}
                  </span>
                </div>

                <span
                  className="shrink-0 text-xs text-slate-400"
                  title={entry.ip ?? undefined}
                >
                  {new Date(entry.createdAt).toLocaleString("en-ZA", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span className="font-mono">
                  {entry.targetType}
                  <span className="text-slate-400"> · </span>
                  <span title={entry.targetId}>
                    {entry.targetId.slice(0, 8)}
                    {entry.targetId.length > 8 ? "…" : ""}
                  </span>
                </span>

                {metadataPreview(entry.metadata) ? (
                  <span className="min-w-0 flex-1 truncate text-slate-400">
                    {metadataPreview(entry.metadata)}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
