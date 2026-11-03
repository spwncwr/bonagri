"use client";

import { FormEvent, useEffect, useState } from "react";
import { authHeaders } from "../../../lib/auth";
import { AdminRowsSkeleton } from "../../../components/admin/admin-ui";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type AudienceCounts = {
  all: number;
  buyer: number;
  supplier: number;
  agroDealer: number;
  transporter: number;
  admin: number;
};

type Broadcast = {
  id: string;
  title: string;
  message: string;
  targetRole: string;
  recipientCount: number;
  sentEmail: boolean;
  createdAt: string;
};

const ROLES = [
  { key: "ALL", label: "All Users", countKey: "all" as const },
  { key: "BUYER", label: "Buyers", countKey: "buyer" as const },
  { key: "SUPPLIER", label: "Suppliers", countKey: "supplier" as const },
  { key: "AGRO_DEALER", label: "Agro-Dealers", countKey: "agroDealer" as const },
  { key: "TRANSPORTER", label: "Transporters", countKey: "transporter" as const },
];

export default function AdminBroadcastNotificationsPage() {
  const [counts, setCounts] = useState<AudienceCounts | null>(null);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Form state
  const [targetRole, setTargetRole] = useState<string>("ALL");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const [countsRes, listRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/admin/notifications/audience-counts`, {
            headers: authHeaders(),
          }),
          fetch(`${API_BASE_URL}/api/admin/notifications/broadcasts`, {
            headers: authHeaders(),
          }),
        ]);

        if (!countsRes.ok || !listRes.ok) {
          throw new Error("Unable to load broadcast data");
        }

        const countsData = (await countsRes.json()) as AudienceCounts;
        const listData = (await listRes.json()) as Broadcast[];

        if (!cancelled) {
          setCounts(countsData);
          setBroadcasts(listData);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load broadcast data",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  async function reloadBroadcasts() {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/admin/notifications/broadcasts`,
        { headers: authHeaders() },
      );
      if (res.ok) {
        setBroadcasts((await res.json()) as Broadcast[]);
      }
    } catch {
      // Best-effort refresh
    }
  }

  async function handleSendBroadcast(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !message.trim()) return;

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/admin/notifications/broadcast`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({
            title: title.trim(),
            message: message.trim(),
            targetRole,
            sendEmail,
          }),
        },
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.message
            ? Array.isArray(data.message)
              ? data.message.join(", ")
              : data.message
            : "Failed to dispatch broadcast",
        );
      }

      setTitle("");
      setMessage("");
      setSendEmail(false);
      setSuccess(
        `Broadcast sent successfully to ${data.recipientCount} user(s)!`,
      );
      await reloadBroadcasts();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to dispatch broadcast",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Role-Targeted Broadcasts
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Reach buyers, suppliers, agro-dealers, or transporters with in-app
          alerts and transactional emails.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          {success}
        </div>
      ) : null}

      {/* Composer form */}
      <form
        onSubmit={(e) => void handleSendBroadcast(e)}
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 className="text-base font-bold text-slate-900">
          Compose Broadcast Announcement
        </h2>

        {/* Target role selector */}
        <div className="mt-5">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Target Audience
          </label>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((role) => {
              const active = targetRole === role.key;
              const count = counts ? counts[role.countKey] : null;

              return (
                <button
                  key={role.key}
                  type="button"
                  onClick={() => setTargetRole(role.key)}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
                    active
                      ? "bg-emerald-700 text-white shadow-sm ring-2 ring-emerald-600 ring-offset-1"
                      : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span>{role.label}</span>
                  {count !== null ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                        active
                          ? "bg-white/20 text-white"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Title */}
        <div className="mt-5">
          <label
            htmlFor="broadcast-title"
            className="mb-1 block text-xs font-medium text-slate-700"
          >
            Announcement Headline
          </label>
          <input
            id="broadcast-title"
            type="text"
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. New Bulk Harvest Rates Available This Week"
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>

        {/* Message */}
        <div className="mt-4">
          <label
            htmlFor="broadcast-message"
            className="mb-1 block text-xs font-medium text-slate-700"
          >
            Message Body
          </label>
          <textarea
            id="broadcast-message"
            required
            rows={4}
            maxLength={1000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Provide clear, concise details about the update, guidelines, or offer..."
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
          <span className="mt-1 block text-right text-xs text-slate-400">
            {message.length} / 1000 characters
          </span>
        </div>

        {/* Email option */}
        <div className="mt-4 flex items-center gap-2">
          <input
            id="send-email"
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-500"
          />
          <label
            htmlFor="send-email"
            className="text-xs font-medium text-slate-700"
          >
            Also send email notification to each recipient
          </label>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
          <p className="text-xs text-slate-400">
            Delivers in-app notifications immediately to recipient bell dropdowns.
          </p>
          <button
            type="submit"
            disabled={submitting || !title.trim() || !message.trim()}
            className="rounded-lg bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Sending..." : "Send Broadcast"}
          </button>
        </div>
      </form>

      {/* Broadcast History */}
      <div>
        <h2 className="mb-4 text-base font-bold text-slate-900">
          Broadcast History
        </h2>

        {loading ? (
          <AdminRowsSkeleton rows={3} label="Loading history..." rowHeight="h-24" />
        ) : broadcasts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            No broadcasts have been sent yet.
          </div>
        ) : (
          <div className="space-y-3">
            {broadcasts.map((b) => (
              <div
                key={b.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-black uppercase text-emerald-800">
                        {b.targetRole}
                      </span>
                      <h3 className="text-sm font-bold text-slate-900">
                        {b.title}
                      </h3>
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-slate-600">
                      {b.message}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <div>
                      {new Date(b.createdAt).toLocaleDateString("en-ZA", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <div className="mt-1 font-semibold text-slate-600">
                      {b.recipientCount} recipient{b.recipientCount === 1 ? "" : "s"}
                      {b.sentEmail ? " • Email sent" : ""}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
