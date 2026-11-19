"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

// F2 badge feed: one bulk request (all of this account's threads) every 30s
// instead of one poll per visible order card. Open threads manage their own
// cursor; this only powers the collapsed "Messages (n)" badges.
const REFRESH_MS = 30000;

export function useMessageUnreads() {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/messages/unread`, {
          headers: authHeaders(),
          cache: "no-store",
        });
        if (!response.ok) return;

        const data = (await response.json()) as { counts?: Record<string, number> };
        if (!cancelled && data.counts) {
          setCounts(data.counts);
        }
      } catch {
        // Silent: badges simply refresh on the next tick.
      }
    };

    void load();
    const timer = setInterval(() => {
      void load();
    }, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return counts;
}
