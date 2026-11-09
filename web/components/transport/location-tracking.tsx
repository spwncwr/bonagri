"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { authHeaders } from "../../lib/auth";
import { ArrowLeftIcon, CallIcon, TruckIcon } from "../mobile/icons";
import LiveMap, { type MapPoint, type RouteStats } from "./live-map";
import { resolvePoint } from "../../lib/geo";
import type { Delivery } from "../../lib/transport";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

function distanceMeters(a: MapPoint, b: MapPoint): number {
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const x = (b.lng - a.lng) * 111_320 * Math.cos(lat);
  const y = (b.lat - a.lat) * 110_574;
  return Math.hypot(x, y);
}

// Routing-service numbers only — this never invents a figure from geometry.
function formatRouteStats(stats: RouteStats): string {
  const km = stats.distanceMeters / 1000;
  const minutes = Math.max(1, Math.round(stats.durationSeconds / 60));
  const kmLabel = km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  const timeLabel =
    minutes >= 60
      ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
      : `${minutes} min`;
  return `${kmLabel} · ${timeLabel}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "TBC";
  return new Date(value).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Presentation constants
   ═══════════════════════════════════════════════════════════════════════════ */

const STEPS = ["Claimed", "Picked Up", "In Transit", "Delivered"] as const;

const STEP_INDEX: Record<Delivery["status"], number> = {
  ASSIGNED: 0,
  PICKED_UP: 1,
  IN_TRANSIT: 2,
  DELIVERED: 3,
  FAILED: -1,
};

const DARK_STATUS: Record<
  Delivery["status"],
  { label: string; cls: string }
> = {
  ASSIGNED: {
    label: "Claimed",
    cls: "bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30",
  },
  PICKED_UP: {
    label: "Picked Up",
    cls: "bg-sky-400/15 text-sky-300 ring-1 ring-sky-400/30",
  },
  IN_TRANSIT: {
    label: "In Transit",
    cls: "bg-indigo-400/15 text-indigo-200 ring-1 ring-indigo-400/30",
  },
  DELIVERED: {
    label: "Delivered",
    cls: "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/30",
  },
  FAILED: {
    label: "Failed",
    cls: "bg-red-400/15 text-red-300 ring-1 ring-red-400/30",
  },
};

type GeoState = "pending" | "live" | "denied" | "unavailable" | "unsupported";

function GpsPill({ state }: { state: GeoState }) {
  const copy: Record<GeoState, { dot: string; label: string }> = {
    pending: { dot: "bg-amber-400", label: "Locating…" },
    live: { dot: "bg-emerald-500", label: "Live GPS" },
    denied: { dot: "bg-slate-400", label: "Location off" },
    unavailable: { dot: "bg-slate-400", label: "Location off" },
    unsupported: { dot: "bg-slate-400", label: "No GPS" },
  };
  const { dot, label } = copy[state];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-[#2c3a2f] shadow-sm backdrop-blur">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function TrackingTimeline({ status }: { status: Delivery["status"] }) {
  const current = STEP_INDEX[status];
  const failed = status === "FAILED";

  return (
    <div className="mt-3">
      <div className="flex items-center">
        {STEPS.map((step, index) => {
          const done = !failed && index <= current;
          const last = index === STEPS.length - 1;
          return (
            <div
              key={step}
              className={`flex items-center ${last ? "" : "flex-1"}`}
            >
              <span
                className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                  done ? "bg-emerald-400" : "bg-white/20"
                }`}
              />
              {!last && (
                <span
                  className={`h-0 flex-1 border-t ${
                    !failed && index < current
                      ? "border-emerald-400/70"
                      : "border-dotted border-white/20"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between">
        {STEPS.map((step, index) => {
          const done = !failed && index <= current;
          return (
            <span
              key={step}
              className={`text-[9px] font-bold ${
                done ? "text-emerald-300" : "text-white/35"
              }`}
            >
              {step}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Location Tracking screen
   ═══════════════════════════════════════════════════════════════════════════ */

export default function LocationTracking({
  delivery,
  onClose,
}: {
  delivery: Delivery;
  onClose: () => void;
}) {
  const supplier =
    delivery.order.items[0]?.product?.supplier ?? null;
  const address = delivery.order.deliveryAddress;
  const buyer = delivery.order.user;

  const pickup = useMemo(
    () => resolvePoint(supplier?.lat, supplier?.lng, supplier?.city),
    [supplier?.lat, supplier?.lng, supplier?.city],
  );
  const dropoff = useMemo(
    () => resolvePoint(address.lat, address.lng, address.city),
    [address.lat, address.lng, address.city],
  );
  // The account phone can be empty while the delivery address still carries
  // the recipient's contact number.
  const contactPhone = buyer.phone ?? address.phone;

  const [geo, setGeo] = useState<GeoState>("pending");
  const [live, setLive] = useState<MapPoint | null>(null);
  const [liveTrail, setLiveTrail] = useState<MapPoint[]>([]);
  const [checkpointTrail, setCheckpointTrail] = useState<MapPoint[]>([]);
  const [focusKey, setFocusKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  // The detail sheet rolls out of the way on a map tap so the route owns the
  // whole screen; the handle line (tap target) brings it back.
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const mapLayerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);

  // Always roll the sheet down from the top, so the collapsed strip shows the
  // handle line (never whatever the transporter scrolled to).
  useEffect(() => {
    if (sheetCollapsed && sheetRef.current) sheetRef.current.scrollTop = 0;
  }, [sheetCollapsed]);

  // Leaflet runs disableClickPropagation on its container, so a map tap never
  // bubbles up to React — listen on the way down (capture phase) instead,
  // which runs before the map's own stopPropagation.
  useEffect(() => {
    const layer = mapLayerRef.current;
    if (!layer) return;
    const collapse = () => setSheetCollapsed(true);
    layer.addEventListener("click", collapse, true);
    return () => layer.removeEventListener("click", collapse, true);
  }, []);
  // undefined = still waiting for the routing service, null = it answered
  // "no route" (failure / nothing to route). LiveMap keeps both honest.
  const [routeStats, setRouteStats] = useState<RouteStats | null | undefined>(
    undefined,
  );
  const lastTrailPoint = useRef<MapPoint | null>(null);

  // Keyless hand-off to the device's own navigation app: the buyer's
  // confirmed pin when the address has one, the readable address otherwise.
  const destinationParam =
    address.lat != null && address.lng != null
      ? `${address.lat},${address.lng}`
      : [address.addressLine1, address.city, address.province]
          .filter(Boolean)
          .join(", ");
  const directionsHref =
    destinationParam.length > 0
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationParam)}`
      : null;

  // Lock the page behind the overlay while tracking is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Previously recorded GPS evidence gives the map a trail immediately,
  // before (or instead of) a live device fix.
  useEffect(() => {
    if (!delivery.id) return;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/deliveries/${delivery.id}/checkpoints`,
          {
            cache: "no-store",
            headers: authHeaders(),
            signal: controller.signal,
          },
        );
        if (!response.ok) return;
        const rows = (await response.json()) as {
          lat: number | null;
          lng: number | null;
        }[];
        const points = rows
          .filter(
            (row): row is { lat: number; lng: number } =>
              row.lat != null && row.lng != null,
          )
          .map((row) => ({ lat: row.lat, lng: row.lng }));
        setCheckpointTrail(points);
      } catch {
        // No ledger yet or offline — live GPS still drives the map.
      }
    })();

    return () => controller.abort();
  }, [delivery.id]);

  // Live device position. This never blocks the screen: if the browser
  // refuses location we simply show the route and saved checkpoints.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      const timer = window.setTimeout(() => setGeo("unsupported"), 0);
      return () => window.clearTimeout(timer);
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setLive(point);
        setGeo("live");

        const previous = lastTrailPoint.current;
        if (!previous || distanceMeters(previous, point) > 15) {
          lastTrailPoint.current = point;
          setLiveTrail((trail) => [...trail.slice(-299), point]);
        }
      },
      (error) => {
        setGeo(
          error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
        );
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const trail = useMemo(
    () => [...checkpointTrail, ...liveTrail],
    [checkpointTrail, liveTrail],
  );
  const courier = live ?? checkpointTrail[checkpointTrail.length - 1] ?? null;

  const status = DARK_STATUS[delivery.status];
  const totalQty = delivery.order.items.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const approximate = pickup.approximate || dropoff.approximate;

  return (
    <div className="fixed inset-0 z-[70] isolate bg-[#e7ebe5]">
      <div ref={mapLayerRef} className="absolute inset-0 z-0">
        <LiveMap
          pickup={pickup.point}
          dropoff={dropoff.point}
          courier={courier}
          trail={trail}
          focusKey={focusKey}
          onRouteStats={setRouteStats}
        />
      </div>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className={`absolute left-3 z-20 rounded bg-white/80 px-2 py-0.5 text-[9px] font-semibold text-[#4b5563] shadow-sm backdrop-blur ${
          sheetCollapsed ? "bottom-[36px]" : "bottom-[calc(62vh_+_8px)]"
        }`}
      >
        © OpenStreetMap contributors
      </a>

      {/* Header */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center">
        <div className="pointer-events-auto relative flex w-full max-w-md items-center gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to transport hub"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white text-[#17251b] shadow-[0_6px_20px_rgba(23,37,27,0.18)] transition active:scale-95"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>

          <div className="flex min-w-0 flex-1 flex-col items-center">
            <span className="max-w-full truncate rounded-full bg-white/90 px-4 py-1.5 text-sm font-black text-[#17251b] shadow-sm backdrop-blur">
              Location Tracking
            </span>
            <span className="mt-2">
              <GpsPill state={geo} />
            </span>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Tracking options"
            aria-expanded={menuOpen}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white text-[#17251b] shadow-[0_6px_20px_rgba(23,37,27,0.18)] transition active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="5" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="12" cy="19" r="1.8" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-4 top-[64px] w-44 overflow-hidden rounded-2xl bg-white p-1 shadow-xl ring-1 ring-black/5">
              <button
                type="button"
                onClick={() => {
                  setFocusKey((key) => key + 1);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-[#2c3a2f] transition hover:bg-[#f2f4ef]"
              >
                <TruckIcon className="h-4 w-4 text-[#17633a]" />
                Centre on route
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-[#2c3a2f] transition hover:bg-[#f2f4ef]"
              >
                <ArrowLeftIcon className="h-4 w-4 text-[#8a948b]" />
                Close tracking
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Detail sheet — rolls down on a map tap, the handle line pulls it back */}
      <div
        id="tracking-detail-sheet"
        className={`absolute inset-x-0 bottom-0 z-20 flex justify-center transition-transform duration-300 ease-out motion-reduce:transition-none ${
          sheetCollapsed
            ? "pointer-events-none translate-y-[calc(100%_-_1.75rem)]"
            : "translate-y-0"
        }`}
      >
        <section
          ref={sheetRef}
          className="max-h-[62vh] w-full max-w-md overflow-y-auto rounded-t-[2rem] bg-[#171b18] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-white shadow-[0_-18px_50px_rgba(0,0,0,0.35)]"
        >
          <button
            type="button"
            onClick={() => setSheetCollapsed((collapsed) => !collapsed)}
            aria-expanded={!sheetCollapsed}
            aria-controls="tracking-detail-sheet"
            aria-label={
              sheetCollapsed
                ? "Show delivery progress"
                : "Hide delivery progress"
            }
            className="-mx-5 -mt-3 flex w-[calc(100%_+_2.5rem)] items-center justify-center pb-3 pt-3 pointer-events-auto"
          >
            <span className="h-1 w-10 rounded-full bg-white/25" />
          </button>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-white/45">
                Booking Id
              </div>
              <div className="mt-0.5 truncate text-xl font-black tracking-tight">
                {delivery.order.orderNumber}
              </div>
            </div>
            <span
              className={`mt-1 flex-shrink-0 rounded-full px-3 py-1 text-[11px] font-black ${status.cls}`}
            >
              {status.label}
            </span>
          </div>

          <TrackingTimeline status={delivery.status} />

          <div className="mt-4 flex justify-between gap-4 text-xs">
            <div>
              <div className="font-semibold text-white/45">Created</div>
              <div className="mt-0.5 font-bold">
                {formatDate(delivery.order.createdAt)}
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-white/45">Estimated</div>
              <div className="mt-0.5 font-bold">
                {formatDate(delivery.estimatedDate)}
              </div>
            </div>
          </div>

          <div className="my-3 border-t border-white/10" />

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <div className="min-w-0">
              <dt className="font-semibold text-white/45">From</dt>
              <dd className="mt-0.5 truncate font-bold">
                {supplier?.city ?? "Pickup TBC"}
              </dd>
            </div>
            <div className="min-w-0 text-right">
              <dt className="font-semibold text-white/45">To</dt>
              <dd className="mt-0.5 truncate font-bold">
                {address.city}
                {address.province ? `, ${address.province}` : ""}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold text-white/45">Customer</dt>
              <dd className="mt-0.5 truncate font-bold">
                {buyer.firstName} {buyer.lastName}
              </dd>
            </div>
            <div className="min-w-0 text-right">
              <dt className="font-semibold text-white/45">Order Cost</dt>
              <dd className="mt-0.5 font-bold">
                R {Number(delivery.order.total ?? 0).toFixed(2)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold text-white/45">Quantity</dt>
              <dd className="mt-0.5 font-bold">
                {totalQty} item{totalQty === 1 ? "" : "s"}
              </dd>
            </div>
            <div className="min-w-0 text-right">
              <dt className="font-semibold text-white/45">Tracking</dt>
              <dd className="mt-0.5 truncate font-bold">
                {delivery.trackingNumber ?? "—"}
              </dd>
            </div>
          </dl>

          {/* Distance/ETA — present only when the routing service answered;
              pending and failure degrade to words, never fake numbers. */}
          <div className="mt-3 rounded-xl bg-white/[0.06] px-3 py-2.5 text-xs">
            <div className="font-semibold text-white/45">Remaining route</div>
            <div className="mt-0.5 font-bold">
              {routeStats
                ? formatRouteStats(routeStats)
                : routeStats === undefined
                  ? "Calculating route…"
                  : "Route unavailable right now — the destination is still marked on the map."}
            </div>
          </div>

          {directionsHref ? (
            <a
              href={directionsHref}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-xs font-black text-white transition hover:bg-white/10"
            >
              Open in Maps
            </a>
          ) : null}

          {delivery.status === "FAILED" && delivery.failedReason && (
            <div className="mt-4 rounded-xl bg-red-500/15 px-3 py-2 text-xs font-bold text-red-300">
              Failure: {delivery.failedReason}
            </div>
          )}

          {approximate && (
            <p className="mt-4 text-[10px] leading-4 text-white/40">
              Pickup or drop-off pins use the city centre — an exact GPS pin has
              not been captured for this order yet.
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-white/[0.06] p-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-black text-emerald-300">
                {buyer.firstName.charAt(0)}
                {buyer.lastName.charAt(0)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">
                  {buyer.firstName} {buyer.lastName}
                </div>
                <div className="text-[11px] text-white/45">Buyer</div>
              </div>
            </div>
            {contactPhone && (
              <div className="flex flex-shrink-0 gap-2">
                <a
                  href={`sms:${contactPhone}`}
                  aria-label="Message buyer"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#17251b] transition active:scale-95"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-4-.9L3 21l1.9-4.6a8.4 8.4 0 0 1-.9-3.9 8.4 8.4 0 0 1 8.4-8.4h.6A8.4 8.4 0 0 1 21 11v.5Z" />
                  </svg>
                </a>
                <a
                  href={`tel:${contactPhone}`}
                  aria-label="Call buyer"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[#17633a] text-white transition active:scale-95"
                >
                  <CallIcon className="h-5 w-5" />
                </a>
              </div>
            )}
          </div>

        </section>
      </div>
    </div>
  );
}
