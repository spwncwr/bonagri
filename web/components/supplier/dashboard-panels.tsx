"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import type { GeoPoint } from "../../lib/geo";
import {
  CompassIcon,
  ExpandIcon,
  MinusIcon,
  PlusIcon,
  ShrinkIcon,
} from "../mobile/icons";

/* ── Card chrome shared by every panel ────────────────────────────────────── */

function CardMenu() {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center gap-[3px] pt-1 text-ink-disabled"
    >
      <span className="h-1 w-1 rounded-full bg-current" />
      <span className="h-1 w-1 rounded-full bg-current" />
    </span>
  );
}

/* ── Stat card (reference's 2x2 grid) ─────────────────────────────────────── */

export function KpiCard({
  label,
  value,
  unit,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: "neutral" | "brand" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "text-ink",
    brand: "text-ink",
    warning: "text-ink",
    danger: "text-ink",
  }[tone];

  return (
    <article className="rounded-3xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold text-ink-faint">{label}</p>
        <CardMenu />
      </div>

      <p className={`mt-4 flex items-baseline gap-1.5 ${toneClass}`}>
        <span className="text-3xl font-black tracking-tight text-ink">
          {value}
        </span>
        {unit ? (
          <span className="text-xs font-bold text-ink-muted">{unit}</span>
        ) : null}
      </p>

      {hint ? (
        <p className="mt-1.5 text-[11px] leading-5 text-ink-muted">{hint}</p>
      ) : null}
    </article>
  );
}

/* ── Flow card (tall companion beside the stat grid) ──────────────────── */

export type FlowRow = {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
};

export type FlowBar = {
  label: string;
  value: number;
  colorVar: string;
};

export function FlowCard({
  title,
  rows,
  heroValue,
  heroLabel,
  bars,
}: {
  title: string;
  rows: FlowRow[];
  heroValue: string;
  heroLabel: string;
  bars: FlowBar[];
}) {
  const ceiling = Math.max(1, ...bars.map((bar) => bar.value));

  return (
    <section className="flex flex-col rounded-3xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-black tracking-tight text-ink">{title}</h3>
        <CardMenu />
      </div>

      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2 text-xs">
            <row.Icon className="h-4 w-4 shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1 truncate text-ink-muted">
              {row.label}
            </span>
            <span className="shrink-0 font-black tabular-nums text-ink">
              {row.value}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-center text-3xl font-black tracking-tight text-ink">
        {heroValue}
      </p>
      <p className="text-center text-[11px] font-bold text-ink-faint">
        {heroLabel}
      </p>

      <div className="mt-4 grid grid-cols-4 gap-1.5 border-t border-line pt-3">
        {bars.map((bar) => (
          <div key={bar.label} className="min-w-0">
            <p className="text-center text-[10px] font-bold tabular-nums text-ink-faint">
              {bar.value}
            </p>
            <div
              className="mt-1 h-6 rounded-full"
              style={{
                background: `repeating-linear-gradient(115deg, var(${bar.colorVar}) 0 4px, transparent 4px 8px)`,
                opacity: 0.35 + (bar.value / ceiling) * 0.65,
              }}
            />
            <p className="mt-1 truncate text-center text-[9px] text-ink-disabled">
              {bar.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Stock health (reference's green gradient bar card) ───────────────────── */

export type StockHealthLine = {
  productId: string;
  name: string;
  available: number;
  reserved: number;
  threshold: number;
  low: boolean;
};

export function StockHealthCard({
  lines,
  lowCount,
  totalLines,
}: {
  lines: StockHealthLine[];
  lowCount: number;
  totalLines: number;
}) {
  // Bars compare each line against the deepest stock in the same set, so the
  // shape is a relative read-out of the shelf rather than an invented score.
  const ceiling = Math.max(1, ...lines.map((line) => line.available));

  return (
    <section className="flex flex-col rounded-3xl bg-[linear-gradient(150deg,var(--theme-success)_0%,var(--theme-accent-color)_100%)] p-5 text-white">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-black tracking-tight">Stock health</h3>
        <span aria-hidden="true" className="flex items-center gap-[3px] pt-1">
          <span className="h-1 w-1 rounded-full bg-white/70" />
          <span className="h-1 w-1 rounded-full bg-white/70" />
        </span>
      </div>

      <p className="mt-1 text-[11px] text-white/80">
        {lowCount} of {totalLines} lines at or below their reorder level.
      </p>

      {lines.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-white/10 px-4 py-6 text-center text-xs text-white/85">
          No inventory lines yet. Add stock from the inventory screen.
        </p>
      ) : (
        <ul className="mt-5 space-y-4">
          {lines.map((line) => (
            <li key={line.productId}>
              <div className="h-3 overflow-hidden rounded-sm bg-white/25">
                <div
                  className="h-full rounded-sm bg-white"
                  style={{
                    width: `${Math.max(2, Math.round((line.available / ceiling) * 100))}%`,
                  }}
                />
              </div>

              {/* Tick ruler, as on the reference's nutrient bars. */}
              <div
                aria-hidden="true"
                className="mt-1 h-2"
                style={{
                  background:
                    "repeating-linear-gradient(90deg, rgba(255,255,255,.55) 0 1px, transparent 1px 7px)",
                }}
              />

              <div className="flex items-end justify-between gap-3">
                <p className="truncate text-xs font-bold">{line.name}</p>
                <p className="shrink-0 text-[11px] font-black tabular-nums">
                  {line.available.toLocaleString("en-ZA")} free
                </p>
              </div>

              <p className="text-[10px] text-white/70">
                {line.reserved.toLocaleString("en-ZA")} reserved • reorder at{" "}
                {line.threshold.toLocaleString("en-ZA")}
                {line.low ? " • needs restock" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Pipeline donut (performance card beside the stock panel) ─────────────── */

export type DonutSegment = {
  label: string;
  value: number;
  colorVar: string;
};

export function PipelineDonut({
  segments,
  centerValue,
  centerLabel,
}: {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const arcLength = (value: number) => (value / total) * circumference;

  const arcs = segments.map((segment, index) => {
    const swept = segments
      .slice(0, index)
      .reduce((sum, item) => sum + arcLength(item.value), 0);
    const length = arcLength(segment.value);

    return {
      segment,
      dash: `${length} ${circumference - length}`,
      offset: -swept,
      // Mid-angle of the slice, used to float its percentage chip.
      mid: ((swept + length / 2) / circumference) * Math.PI * 2,
      share: total === 0 ? 0 : Math.round((segment.value / total) * 100),
    };
  });

  return (
    <section className="flex flex-col rounded-3xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-black tracking-tight text-ink">
          Fulfilment pipeline
        </h3>
        <CardMenu />
      </div>

      {total === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-line bg-page px-4 py-6 text-center text-xs text-ink-muted">
          No orders to chart yet.
        </p>
      ) : (
        <>
          <div className="relative mx-auto mt-4 h-[196px] w-[196px]">
            <svg
              viewBox="0 0 132 132"
              className="h-full w-full -rotate-90"
              aria-hidden="true"
            >
              <circle
                cx="66"
                cy="66"
                r={radius}
                fill="none"
                strokeWidth="16"
                style={{ stroke: "var(--theme-elevated-surface)" }}
              />
              {arcs.map(({ segment, dash, offset }) => (
                <circle
                  key={segment.label}
                  cx="66"
                  cy="66"
                  r={radius}
                  fill="none"
                  strokeWidth="16"
                  strokeDasharray={dash}
                  strokeDashoffset={offset}
                  style={{ stroke: `var(${segment.colorVar})` }}
                />
              ))}
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                {centerLabel}
              </p>
              <p className="text-3xl font-black text-ink">{centerValue}</p>
            </div>

            {arcs
              .filter((arc) => arc.segment.value > 0)
              .map((arc) => (
                <span
                  key={`${arc.segment.label}-chip`}
                  className="absolute rounded-xl border border-line bg-surface px-2 py-1 text-[10px] font-black tabular-nums text-ink shadow-sm"
                  style={{
                    left: `calc(50% + ${Math.cos(arc.mid) * 92}px)`,
                    top: `calc(50% + ${Math.sin(arc.mid) * 92}px)`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  {arc.share}%
                </span>
              ))}
          </div>

          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            {segments.map((segment) => (
              <li
                key={segment.label}
                className="flex items-center gap-1.5 text-[11px] text-ink-muted"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: `var(${segment.colorVar})` }}
                />
                {segment.label}
                <span className="font-black tabular-nums text-ink">
                  {segment.value.toLocaleString("en-ZA")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* ── Delivery coverage (reference's tall map column) ──────────────────────── */

export type CoverageMarker = GeoPoint & {
  id: string;
  label: string;
  city: string;
  approximate: boolean;
  tone: "brand" | "warning" | "info";
};

export type CoverageCity = {
  city: string;
  province: string;
  orders: number;
  pinned: number;
};

const toneVar = {
  brand: "--theme-success",
  warning: "--theme-warning",
  info: "--theme-info",
} as const;

function markerIcon(L: typeof import("leaflet"), marker: CoverageMarker) {
  return L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<span style="display:block;width:22px;height:22px;border-radius:9999px;border:2px solid #fff;box-shadow:0 0 0 5px color-mix(in srgb, var(${toneVar[marker.tone]}) 28%, transparent), 0 2px 6px rgba(0,0,0,.28);background:var(${toneVar[marker.tone]})"></span>`,
  });
}

export function CoveragePanel({
  markers,
  cities,
  headline,
}: {
  markers: CoverageMarker[];
  cities: CoverageCity[];
  headline: string;
}) {
  const [mode, setMode] = useState<"map" | "list">("map");
  const [expanded, setExpanded] = useState(false);
  const [chips, setChips] = useState<
    { id: string; x: number; y: number; label: string }[]
  >([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markerRef = useRef<CoverageMarker[]>([]);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    void (async () => {
      const L = await import("leaflet");
      if (cancelled) return;

      leafletRef.current = L;
      const map = L.map(container, {
        scrollWheelZoom: false,
        zoomControl: false,
        attributionControl: false,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;

      // The panel is inside a CSS grid, so Leaflet needs a nudge once the
      // column has its final width.
      window.setTimeout(() => map.invalidateSize(), 120);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    markerRef.current = markers;
  }, [markers]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const layer = layerRef.current;
    if (!map || !L || !layer || mode !== "map") return;

    layer.clearLayers();

    for (const marker of markers) {
      L.marker([marker.lat, marker.lng], {
        icon: markerIcon(L, marker),
        title: marker.label,
      })
        .bindTooltip(
          `${marker.label}${marker.approximate ? " (city centre)" : ""}`,
          { direction: "top", offset: [0, -10] },
        )
        .addTo(layer);
    }

    if (markers.length > 0) {
      const bounds = L.latLngBounds(
        markers.map((marker) => [marker.lat, marker.lng] as [number, number]),
      );
      map.fitBounds(bounds, { padding: [56, 56], maxZoom: 11 });
    }

    map.invalidateSize();
  }, [markers, mode, expanded]);

  // Frosted labels ride on the real marker positions, so they move with the
  // map instead of being painted at fixed spots.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mode !== "map") return;

    const paint = () => {
      const next = markerRef.current.slice(0, 3).map((marker) => {
        const point = map.latLngToContainerPoint([marker.lat, marker.lng]);
        return {
          id: marker.id,
          x: Math.round(point.x),
          y: Math.round(point.y),
          label: marker.city,
        };
      });
      setChips(next);
    };

    paint();
    map.on("move zoom resize", paint);
    return () => {
      map.off("move zoom resize", paint);
    };
  }, [markers, mode, expanded]);

  const pinned = markers.length - markers.filter((m) => m.approximate).length;

  return (
    <section
      className={`relative flex min-h-[440px] flex-col overflow-hidden rounded-3xl border border-line bg-surface lg:min-h-0 ${
        expanded ? "fixed inset-3 z-50 shadow-2xl" : ""
      }`}
    >
      {/* The mount div keeps a constant className: React rewrites that
          attribute, and Leaflet stores its own classes on it. Visibility is
          toggled on a wrapper instead. */}
      <div
        className={`absolute inset-0 z-0 ${mode === "map" ? "" : "invisible"}`}
        aria-hidden={mode !== "map"}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>

      {/* Top-left: view switch, styled as the reference's floating chip. */}
      <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
        <div
          role="radiogroup"
          aria-label="Coverage view"
          className="flex items-center gap-1 rounded-full border border-line bg-surface/85 p-1 shadow-sm backdrop-blur"
        >
          {(["map", "list"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              onClick={() => setMode(option)}
              className={`rounded-full px-3 py-1 text-[11px] font-black capitalize transition ${
                mode === option
                  ? "bg-ink text-page"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <p className="hidden max-w-[220px] rounded-full bg-surface/85 px-3 py-1.5 text-[11px] font-bold text-ink-soft shadow-sm backdrop-blur xl:block">
          {headline}
        </p>
      </div>

      {/* Top-right: expand, as on the reference map. */}
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-label={expanded ? "Shrink map" : "Expand map"}
        className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface/85 text-ink-muted shadow-sm backdrop-blur transition hover:text-ink"
      >
        {expanded ? (
          <ShrinkIcon className="h-4 w-4" />
        ) : (
          <ExpandIcon className="h-4 w-4" />
        )}
      </button>

      {mode === "map" ? (
        <>
          {markers.length === 0 ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center">
              <p className="rounded-2xl bg-surface/85 px-4 py-3 text-xs text-ink-muted backdrop-blur">
                No deliverable destinations on your open orders yet.
              </p>
            </div>
          ) : (
            chips.map((chip) => (
              <span
                key={chip.id}
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[26px] whitespace-nowrap rounded-xl border border-line bg-surface/85 px-2.5 py-1 text-[11px] font-bold text-ink shadow-sm backdrop-blur"
                style={{ left: chip.x, top: chip.y }}
              >
                {chip.label}
              </span>
            ))
          )}

          <div className="absolute bottom-4 right-4 z-20 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const map = mapRef.current;
                if (!map || markers.length === 0) return;
                const bounds = (leafletRef.current as typeof import("leaflet"))?.latLngBounds(
                  markers.map(
                    (marker) => [marker.lat, marker.lng] as [number, number],
                  ),
                );
                if (bounds) map.fitBounds(bounds, { padding: [56, 56], maxZoom: 11 });
              }}
              aria-label="Recenter on my deliveries"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface/85 text-ink-muted shadow-sm backdrop-blur transition hover:text-ink"
            >
              <CompassIcon className="h-4 w-4" />
            </button>

            <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface/85 shadow-sm backdrop-blur">
              <button
                type="button"
                onClick={() => mapRef.current?.zoomIn()}
                aria-label="Zoom in"
                className="flex h-9 w-9 items-center justify-center text-ink-muted transition hover:text-ink"
              >
                <PlusIcon className="h-4 w-4" />
              </button>
              <span className="h-px w-full bg-line" />
              <button
                type="button"
                onClick={() => mapRef.current?.zoomOut()}
                aria-label="Zoom out"
                className="flex h-9 w-9 items-center justify-center text-ink-muted transition hover:text-ink"
              >
                <MinusIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <p className="absolute bottom-4 left-4 z-20 max-w-[62%] rounded-xl border border-line bg-surface/85 px-3 py-2 text-[10px] leading-4 text-ink-muted shadow-sm backdrop-blur">
            {cities.length} destination{cities.length === 1 ? "" : "s"} •{" "}
            {markers.length} open pin{markers.length === 1 ? "" : "s"} •{" "}
            {pinned} exact {pinned === 1 ? "pin" : "pins"} •{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              OpenStreetMap
            </a>
          </p>
        </>
      ) : (
        <div className="mt-20 flex-1 overflow-y-auto px-4 pb-4">
          {cities.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line bg-page px-4 py-8 text-center text-xs text-ink-muted">
              No destinations on your open orders yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {cities.map((city) => (
                <li
                  key={`${city.city}-${city.province}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3.5 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-black text-ink">
                      {city.city}
                    </span>
                    <span className="block text-[10px] text-ink-faint">
                      {city.province} • {city.pinned} exact pin
                      {city.pinned === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-black text-success-bright">
                    {city.orders} open
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
