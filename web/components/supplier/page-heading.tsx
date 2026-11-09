"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { goBackOr } from "../../lib/navigation";
import { ArrowLeftIcon } from "../mobile/icons";

// The heading every desk screen shares: a true history-aware back button
// (deep links fall back to `fallback` instead of backing out of the app),
// the screen title, and an optional action row that wraps on phones.
type PageHeadingProps = {
  title: string;
  description?: string;
  /** Where a deep link should land instead of history.back(). */
  fallback?: string;
  actions?: ReactNode;
};

export default function PageHeading({
  title,
  description,
  fallback = "/supplier",
  actions,
}: PageHeadingProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <button
          type="button"
          onClick={() => goBackOr(router, fallback)}
          aria-label="Back"
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-line bg-surface text-ink-muted transition hover:bg-surface-raised hover:text-ink"
        >
          <ArrowLeftIcon className="h-4 w-4" strokeWidth={2.2} />
        </button>

        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-tight text-ink sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              {description}
            </p>
          ) : null}
        </div>
      </div>

      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
