"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type Notification = {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
};

export default function NotificationsPanel({
  title = "Notifications",
}: {
  title?: string;
}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/notifications`, {
          cache: "no-store",
          headers: authHeaders(),
        });

        if (response.ok && !cancelled) {
          setItems((await response.json()) as Notification[]);
        }
      } catch {
        // Non-blocking panel: leave empty on failure.
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function markRead(notificationId: string) {
    setMarkingId(notificationId);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/notifications/${notificationId}/read`,
        {
          method: "PATCH",
          headers: authHeaders(),
        },
      );

      if (response.ok) {
        setItems((current) =>
          current.map((item) =>
            item.id === notificationId ? { ...item, read: true } : item,
          ),
        );
      }
    } finally {
      setMarkingId(null);
    }
  }

  const unread = items.filter((item) => !item.read).length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {loaded && items.length > 0 ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            {unread} unread
          </span>
        ) : null}
      </div>

      {!loaded ? (
        <p className="mt-4 text-sm text-slate-500">Loading notifications...</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          Nothing here yet — updates about your orders and account will appear
          here.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className={`rounded-xl border p-4 text-sm ${
                item.read
                  ? "border-slate-100 bg-slate-50"
                  : "border-emerald-200 bg-emerald-50"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p
                    className={`font-semibold ${
                      item.read ? "text-slate-700" : "text-slate-900"
                    }`}
                  >
                    {item.title}
                  </p>
                  <p className="mt-1 text-slate-600">{item.message}</p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <p className="text-xs text-slate-400">
                    {new Date(item.createdAt).toLocaleString("en-ZA", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>

                  {!item.read ? (
                    <button
                      type="button"
                      disabled={markingId === item.id}
                      onClick={() => void markRead(item.id)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {markingId === item.id ? "Marking..." : "Mark read"}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
