"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/* Shared surfaces for the dark admin shell (reference: Finity dashboard). */

export function AdminCard({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-3xl border border-white/6 bg-[#14141d] p-6 shadow-[0_20px_44px_-30px_rgba(0,0,0,0.9)] ${className}`}
    >
      {title || action ? (
        <header className="flex items-center justify-between gap-3">
          {title ? (
            <h2 className="text-lg font-bold tracking-tight text-white">
              {title}
            </h2>
          ) : null}
          {action}
        </header>
      ) : null}
      <div className={title || action ? "mt-5" : ""}>{children}</div>
    </section>
  );
}

export function AdminPillLink({
  href,
  children,
  tone = "ghost",
}: {
  href: string;
  children: ReactNode;
  tone?: "ghost" | "accent";
}) {
  return (
    <Link href={href} className={pillClass(tone)}>
      {children}
    </Link>
  );
}

function pillClass(tone: "ghost" | "accent") {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition";
  return tone === "accent"
    ? `${base} bg-emerald-500/18 text-emerald-300 hover:bg-emerald-500/28`
    : `${base} border border-white/10 bg-white/6 text-slate-200 hover:bg-white/12 hover:text-white`;
}

/* Circular percentage ring, as used on the reference "Financial goals" card. */
export function RingProgress({
  value,
  size = 46,
  stroke = 4,
  tone = "#34d399",
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, value));

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={tone}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fill="#fff"
        fontSize={size * 0.27}
        fontWeight={700}
      >
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

/* Segmented progress track, as used on the reference "Daily limit" card. */
export function SegmentBar({
  value,
  max,
  segments = 14,
  tone = "#34d399",
}: {
  value: number;
  max: number;
  segments?: number;
  tone?: string;
}) {
  const filled = Math.max(
    0,
    Math.min(segments, Math.round((value / (max || 1)) * segments)),
  );

  return (
    <div className="flex gap-1" aria-hidden="true">
      {Array.from({ length: segments }, (_, index) => (
        <span
          key={index}
          className="h-1.5 flex-1 rounded-full"
          style={{
            backgroundColor:
              index < filled ? tone : "rgba(255,255,255,0.1)",
          }}
        />
      ))}
    </div>
  );
}

/* Donut with a centred caption, as used on the reference "All Expenses" card. */
export function DonutChart({
  slices,
  centerLabel,
  centerValue,
  size = 190,
}: {
  slices: { label: string; value: number; color: string }[];
  centerLabel: string;
  centerValue: string;
  size?: number;
}) {
  const stroke = 26;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0) || 1;

  const arcs = slices.map((slice, index) => {
    const length = (slice.value / total) * circumference;
    const preceding = slices
      .slice(0, index)
      .reduce((sum, item) => sum + (item.value / total) * circumference, 0);

    return {
      label: slice.label,
      color: slice.color,
      dash: `${Math.max(length - 2, 0)} ${circumference - Math.max(length - 2, 0)}`,
      shift: -preceding,
    };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${centerLabel}: ${centerValue}`}
      className="shrink-0"
    >
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={stroke}
        />
        {arcs.map((arc) => (
          <circle
            key={arc.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={stroke}
            strokeDasharray={arc.dash}
            strokeDashoffset={arc.shift}
          />
        ))}
      </g>
      <text
        x="50%"
        y="44%"
        dominantBaseline="central"
        textAnchor="middle"
        fill="rgba(255,255,255,0.55)"
        fontSize="12"
        fontWeight={600}
      >
        {centerLabel}
      </text>
      <text
        x="50%"
        y="58%"
        dominantBaseline="central"
        textAnchor="middle"
        fill="#fff"
        fontSize="22"
        fontWeight={800}
      >
        {centerValue}
      </text>
    </svg>
  );
}

/* Shimmer placeholders matching the dashboard grid while stats load. */
function Block({
  className = "",
  rounded = "rounded-xl",
}: {
  className?: string;
  rounded?: string;
}) {
  return (
    <div aria-hidden className={`shimmer bg-white/6 ${rounded} ${className}`} />
  );
}

export function AdminDashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard statistics">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <AdminCard className="xl:col-span-3">
          <Block className="h-4 w-28" />
          <Block className="mt-4 h-9 w-36" />
          <div className="mt-5 flex gap-2">
            <Block className="h-9 w-24" rounded="rounded-full" />
            <Block className="h-9 w-24" rounded="rounded-full" />
          </div>
          <Block className="mt-6 h-px w-full" />
          <div className="mt-5 grid grid-cols-2 gap-4">
            <Block className="h-10" />
            <Block className="h-10" />
          </div>
          <Block className="mt-5 h-1.5 w-full" rounded="rounded-full" />
        </AdminCard>

        <AdminCard className="xl:col-span-5">
          <Block className="h-4 w-32" />
          <Block className="mt-4 h-9 w-40" />
          <Block className="mt-6 h-40 w-full" rounded="rounded-2xl" />
          <div className="mt-4 flex gap-1">
            {Array.from({ length: 7 }, (_, index) => (
              <Block key={index} className="h-3 flex-1" rounded="rounded-full" />
            ))}
          </div>
        </AdminCard>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
          <AdminCard>
            <Block className="h-4 w-28" />
            <Block className="mt-4 h-32 w-full" rounded="rounded-2xl" />
          </AdminCard>
          <AdminCard>
            <Block className="h-4 w-28" />
            <Block className="mt-5 h-1.5 w-full" rounded="rounded-full" />
            <Block className="mt-3 h-3 w-40" />
          </AdminCard>
        </div>

        <AdminCard className="xl:col-span-5">
          <Block className="h-4 w-36" />
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="mt-5 flex items-center gap-4">
              <Block className="h-11 w-11" rounded="rounded-full" />
              <Block className="h-8 flex-1" />
            </div>
          ))}
        </AdminCard>

        <AdminCard className="xl:col-span-3">
          <Block className="h-4 w-24" />
          <Block className="mx-auto mt-5 h-40 w-40" rounded="rounded-full" />
        </AdminCard>

        <AdminCard className="xl:col-span-4">
          <Block className="h-4 w-24" />
          {Array.from({ length: 4 }, (_, index) => (
            <Block
              key={index}
              className="mt-3.5 h-12 w-full"
              rounded="rounded-2xl"
            />
          ))}
        </AdminCard>
      </div>
    </div>
  );
}

/* Dark splash shown while the admin session check resolves. */
export function AdminSessionSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Checking your BonAgri session"
      className="admin-dark min-h-screen bg-[#0b0b12] px-6 py-6 text-slate-100"
    >
      <div className="mx-auto max-w-[1400px]">
        <div className="flex items-center gap-3 rounded-2xl border border-white/6 bg-[#12121a] px-4 py-3">
          <Block className="h-9 w-40" rounded="rounded-full" />
          <div className="ml-auto flex gap-2">
            <Block className="h-9 w-40" rounded="rounded-full" />
            <Block className="h-9 w-9" rounded="rounded-full" />
            <Block className="h-9 w-9" rounded="rounded-full" />
          </div>
        </div>
        <div className="mt-6 flex gap-6">
          <Block className="hidden h-[440px] w-[60px] shrink-0 xl:block" rounded="rounded-3xl" />
          <div className="min-w-0 flex-1">
            <AdminDashboardSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}

/* Shimmer list rows for the admin subpages while their collections load. */
export function AdminRowsSkeleton({
  rows = 5,
  label,
  className = "",
  rowHeight = "h-24",
}: {
  rows?: number;
  label: string;
  className?: string;
  rowHeight?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className={`space-y-3 ${className}`}
    >
      {Array.from({ length: rows }, (_, index) => (
        <Block key={index} className={`w-full ${rowHeight}`} rounded="rounded-2xl" />
      ))}
    </div>
  );
}
