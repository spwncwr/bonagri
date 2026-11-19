"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { authHeaders } from "../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

// F2: polling-only MVP (plan §F2) — no WebSocket, no read receipts, no
// media. An open thread refreshes every 4s and holds its own unread cursor
// at zero; a collapsed thread takes its badge from the parent's bulk feed.
const POLL_MS = 4000;

type ThreadMessage = {
  id: string;
  body: string;
  createdAt: string;
  senderId: string;
  senderName: string;
  isOwn: boolean;
};

type ThreadPayload = {
  orderNumber: string;
  readOnly: boolean;
  unreadCount: number;
  messages: ThreadMessage[];
};

async function fetchThread(orderId: string): Promise<ThreadPayload | null> {
  const response = await fetch(
    `${API_BASE_URL}/api/orders/${orderId}/messages`,
    {
      headers: authHeaders(),
      cache: "no-store",
    },
  );

  if (!response.ok) return null;
  return (await response.json()) as ThreadPayload;
}

export function OrderThread({
  orderId,
  unread = 0,
  defaultOpen = false,
}: {
  orderId: string;
  unread?: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [thread, setThread] = useState<ThreadPayload | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // Promise-chain form (not async/await) so the poll effect can kick it
  // off without a synchronous setState path — set-state-in-effect lint.
  const load = useCallback(() => {
    return fetchThread(orderId)
      .then((next) => {
        if (!next) return;

        setThread(next);
        setError("");

        // An OPEN thread clears its own badge: any unread rows are posted
        // back as read so the bell and list badge drop on their next feed.
        if (next.unreadCount > 0) {
          void fetch(`${API_BASE_URL}/api/orders/${orderId}/messages/read`, {
            method: "POST",
            headers: authHeaders(),
          }).catch(() => undefined);
        }
      })
      .catch(() => {
        setError("Could not reach the conversation — retrying…");
      });
  }, [orderId]);

  // Fetch on open, then poll while open (the exit criteria's live exchange).
  useEffect(() => {
    if (!open) return;

    void load();
    const timer = setInterval(() => {
      void load();
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [open, load]);

  // Keep the newest message in view without jumping the host page.
  useEffect(() => {
    const element = listRef.current;
    if (open && element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [open, thread?.messages.length]);

  const send = async (event: FormEvent) => {
    event.preventDefault();

    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders/${orderId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({ body }),
        },
      );

      if (!response.ok) {
        setError(
          response.status === 403
            ? "Admins have read-only access to this conversation."
            : "The message could not be sent.",
        );
        return;
      }

      setDraft("");
      await load();
    } catch {
      setError("The message could not be sent — check your connection.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 rounded-xl border border-[#e3e8e1] bg-white px-4 py-2 text-sm font-semibold text-[#2c3a2f] transition hover:bg-[#f6f8f4]"
      >
        {open ? "Hide messages" : "Messages"}
        {!open && unread > 0 ? (
          <span className="rounded-full bg-[#17633a] px-2 py-0.5 text-[10px] font-black text-white">
            {unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="mt-3 rounded-2xl border border-[#e3e8e1] bg-[#fafbf8] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#7b867d]">
              {thread
                ? `Conversation · ${thread.orderNumber}`
                : "Conversation"}
            </p>
            <span className="text-[11px] text-[#8a948b]">
              Updates every few seconds
            </span>
          </div>

          <div
            ref={listRef}
            className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1"
          >
            {thread === null ? (
              <p className="py-4 text-center text-sm text-[#69756c]">
                Loading the conversation…
              </p>
            ) : thread.messages.length === 0 ? (
              <p className="py-4 text-center text-sm text-[#69756c]">
                No messages yet — start the conversation.
              </p>
            ) : (
              thread.messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.isOwn ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      message.isOwn
                        ? "bg-[#17633a] text-white"
                        : "border border-[#e3e8e1] bg-white text-[#2c3a2f]"
                    }`}
                  >
                    {!message.isOwn ? (
                      <p className="text-[11px] font-bold text-[#17633a]">
                        {message.senderName}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words">
                      {message.body}
                    </p>
                    <p
                      className={`mt-1 text-[10px] ${
                        message.isOwn ? "text-white/70" : "text-[#8a948b]"
                      }`}
                    >
                      {new Date(message.createdAt).toLocaleString("en-ZA", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {error ? (
            <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>
          ) : null}

          {thread?.readOnly ? (
            <p className="mt-3 rounded-xl border border-[#e3e8e1] bg-white px-3 py-2 text-xs text-[#69756c]">
              Admin view — you can read this conversation, but not post to it.
            </p>
          ) : (
            <form onSubmit={send} className="mt-3 flex gap-2">
              <input
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Write a message…"
                maxLength={2000}
                className="min-w-0 flex-1 rounded-xl border border-[#e3e8e1] bg-white px-3 py-2 text-sm text-[#2c3a2f] placeholder:text-[#8a948b]"
              />
              <button
                type="submit"
                disabled={sending || draft.trim().length === 0}
                className="rounded-xl bg-[#17633a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#12512f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send"}
              </button>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
