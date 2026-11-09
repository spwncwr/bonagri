"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap, Marker, Polyline } from "leaflet";

export type MapPoint = { lat: number; lng: number };

// Distance/ETA handed to the UI *only* when the routing service answered —
// null means "no route data", never a straight-line estimate.
export type RouteStats = {
  distanceMeters: number;
  durationSeconds: number;
};

type Props = {
  pickup: MapPoint | null;
  dropoff: MapPoint | null;
  courier: MapPoint | null;
  trail: MapPoint[];
  // Bump this number to re-fit the camera to the route and current position.
  focusKey?: number;
  // Chrome overlaying the map: the mobile sheet covers the lower part of the
  // screen, a desktop panel covers nothing. Defaults keep the tracking
  // overlay's original framing.
  topInsetPx?: number;
  bottomInsetRatio?: number;
  // Fires with OSRM's numbers after each successful route, or null when the
  // routing service failed / there is nothing to route.
  onRouteStats?: (stats: RouteStats | null) => void;
};

// Keyless OSM tiles (CARTO's CDN now requires an API key). The tile pane is
// desaturated in the container classes so it keeps the light, calm look of
// the reference design.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Re-request the route only after the courier (or, before pickup, the route
// origin) has moved meaningfully — GPS ticks are ~1/s.
const REROUTE_AFTER_M = 100;
// Minimum spacing between retries when the routing service itself failed.
const ROUTE_RETRY_MS = 15_000;

function toLatLng(point: MapPoint): [number, number] {
  return [point.lat, point.lng];
}

function boundsOf(points: MapPoint[]): [number, number][] {
  return points.map(toLatLng);
}

function distanceMeters(a: MapPoint, b: MapPoint): number {
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const x = (b.lng - a.lng) * 111_320 * Math.cos(lat);
  const y = (b.lat - a.lat) * 110_574;
  return Math.hypot(x, y);
}

// The detail sheet covers the lower part of the screen, so fit the route
// into the strip that stays visible above it.
function fitToPoints(
  map: LeafletMap,
  points: MapPoint[],
  animate: boolean,
  topInsetPx = 96,
  bottomInsetRatio = 0.63,
): void {
  if (points.length === 0) return;
  if (points.length === 1) {
    map.setView(toLatLng(points[0]), 14, { animate: false });
    return;
  }
  const bottom = Math.round(map.getSize().y * bottomInsetRatio);
  map.fitBounds(boundsOf(points), {
    paddingTopLeft: [32, topInsetPx],
    paddingBottomRight: [32, bottom],
    maxZoom: 15,
    animate,
  });
}

// Custom HTML markers keep the map free of Leaflet's default icon assets and
// match the app's palette (emerald pickup, orange drop, dark courier bubble).
function pickupIcon(L: typeof import("leaflet")) {
  return L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#17633a;border:3px solid #fff;box-shadow:0 6px 16px rgba(23,37,27,.28)">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
    </div>`,
  });
}

function dropoffIcon(L: typeof import("leaflet")) {
  return L.divIcon({
    className: "",
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    html: `<div style="position:relative;width:42px;height:42px;display:flex;align-items:center;justify-content:center">
      <span style="position:absolute;inset:0;border-radius:50%;background:rgba(244,112,58,.18)"></span>
      <span style="width:24px;height:24px;border-radius:50%;background:#f4703a;border:4px solid #fff;box-shadow:0 5px 14px rgba(244,112,58,.45)"></span>
    </div>`,
  });
}

function courierIcon(L: typeof import("leaflet")) {
  return L.divIcon({
    className: "",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#1f2937;border:3px solid #fff;box-shadow:0 8px 22px rgba(0,0,0,.35)">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2 4.5 20.2a.6.6 0 0 0 .9.7L12 17.6l6.6 3.3a.6.6 0 0 0 .9-.7L12 2Z"/></svg>
    </div>`,
  });
}

export default function LiveMap({
  pickup,
  dropoff,
  courier,
  trail,
  focusKey = 0,
  topInsetPx = 96,
  bottomInsetRatio = 0.63,
  onRouteStats,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const pointLayerRef = useRef<LayerGroup | null>(null);
  const routeRef = useRef<Polyline | null>(null);
  const trailRef = useRef<Polyline | null>(null);
  const courierRef = useRef<Marker | null>(null);
  const onRouteStatsRef = useRef(onRouteStats);

  useEffect(() => {
    onRouteStatsRef.current = onRouteStats;
  }, [onRouteStats]);

  // Last origin the routing service was asked about — the throttle gate for
  // re-routing as the courier moves (plus a slow retry after a failure).
  const routedFromRef = useRef<{
    start: MapPoint;
    key: string;
    failedAt?: number;
  } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      const L = await import("leaflet");
      if (disposed || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
      }).setView([-24.5, 29.5], 7);

      L.tileLayer(TILE_URL, {
        attribution: ATTRIBUTION,
        maxZoom: 19,
      }).addTo(map);

      leafletRef.current = L;
      mapRef.current = map;
      pointLayerRef.current = L.layerGroup().addTo(map);
      setReady(true);
      window.setTimeout(() => map.invalidateSize(), 80);
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
      pointLayerRef.current = null;
      routeRef.current = null;
      trailRef.current = null;
      courierRef.current = null;
      setReady(false);
    };
  }, []);

  // Pickup + destination pins and the camera fit. The route line itself is
  // owned by the routing effect below so it can follow the courier.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const points = pointLayerRef.current;
    if (!ready || !L || !map || !points) return;

    points.clearLayers();

    const pickupPoint = pickup;
    const dropoffPoint = dropoff;

    if (pickupPoint) {
      L.marker(toLatLng(pickupPoint), {
        icon: pickupIcon(L),
        title: "Pickup",
        keyboard: false,
      }).addTo(points);
    }

    if (dropoffPoint) {
      L.marker(toLatLng(dropoffPoint), {
        icon: dropoffIcon(L),
        title: "Delivery address",
        keyboard: false,
      }).addTo(points);
    }

    const targets = [pickupPoint, dropoffPoint, courier].filter(
      (point): point is MapPoint => point !== null,
    );
    fitToPoints(map, targets, false, topInsetPx, bottomInsetRatio);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- courier only seeds the initial fit
  }, [ready, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  // Route: from the courier's own position once tracking (else the pickup)
  // to the destination pin. Straight line first so the map is never empty;
  // real road geometry replaces it when the public OSRM demo answers, which
  // is also the only source of distance/ETA numbers.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    const start = courier ?? pickup;
    const key = dropoff ? `${dropoff.lat},${dropoff.lng}` : "";

    if (!start || !dropoff) {
      routeRef.current?.remove();
      routeRef.current = null;
      routedFromRef.current = null;
      onRouteStatsRef.current?.(null);
      return;
    }

    // Throttle: same destination and the origin hasn't moved far enough.
    // A failed route retries on the next tick after ROUTE_RETRY_MS instead
    // of hammering the service every second.
    const previous = routedFromRef.current;
    const retryDue =
      previous?.failedAt != null &&
      Date.now() - previous.failedAt >= ROUTE_RETRY_MS;
    if (
      previous &&
      previous.key === key &&
      distanceMeters(previous.start, start) < REROUTE_AFTER_M &&
      !retryDue
    ) {
      return;
    }

    routedFromRef.current = { start, key };

    routeRef.current?.remove();
    routeRef.current = L.polyline(boundsOf([start, dropoff]), {
      color: "#27302a",
      weight: 5,
      opacity: 0.85,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);

    // Real road geometry when the public OSRM demo responds; the straight
    // line above stays as the fallback when it does not.
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const url =
      "https://router.project-osrm.org/route/v1/driving/" +
      `${start.lng},${start.lat};${dropoff.lng},${dropoff.lat}` +
      "?overview=full&geometries=geojson";

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`osrm ${response.status}`);
        const body = (await response.json()) as {
          routes?: {
            geometry?: { coordinates?: [number, number][] };
            distance?: number;
            duration?: number;
          }[];
        };
        const route = body.routes?.[0];
        const coordinates = route?.geometry?.coordinates;
        if (!coordinates || coordinates.length < 2) {
          throw new Error("empty route");
        }

        const path = coordinates.map(
          ([lng, lat]) => [lat, lng] as [number, number],
        );
        routeRef.current?.remove();
        routeRef.current = L.polyline(path, {
          color: "#27302a",
          weight: 5,
          opacity: 0.9,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);
        routeRef.current.bringToBack();

        if (
          typeof route?.distance === "number" &&
          typeof route?.duration === "number"
        ) {
          onRouteStatsRef.current?.({
            distanceMeters: route.distance,
            durationSeconds: route.duration,
          });
        } else {
          onRouteStatsRef.current?.(null);
        }
      } catch {
        // Offline or rate-limited: the straight route remains and the UI
        // gets no numbers (never a fabricated estimate).
        if (routedFromRef.current?.key === key) {
          routedFromRef.current = { ...routedFromRef.current, failedAt: Date.now() };
        }
        onRouteStatsRef.current?.(null);
      } finally {
        window.clearTimeout(timer);
      }
    })();

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run is governed by the throttle above
  }, [
    ready,
    pickup?.lat,
    pickup?.lng,
    dropoff?.lat,
    dropoff?.lng,
    courier?.lat,
    courier?.lng,
  ]);

  // Breadcrumb of positions already travelled (server checkpoints + live GPS).
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    trailRef.current?.remove();
    trailRef.current = null;

    if (trail.length < 2) return;

    trailRef.current = L.polyline(boundsOf(trail), {
      color: "#16a34a",
      weight: 4,
      opacity: 0.55,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);
  }, [ready, trail]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    if (!courier) {
      courierRef.current?.remove();
      courierRef.current = null;
      return;
    }

    if (!courierRef.current) {
      courierRef.current = L.marker(toLatLng(courier), {
        icon: courierIcon(L),
        title: "Your position",
        keyboard: false,
        zIndexOffset: 500,
      }).addTo(map);
    } else {
      courierRef.current.setLatLng(toLatLng(courier));
    }
  }, [ready, courier]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    map.invalidateSize();
    const targets = [pickup, dropoff, courier].filter(
      (point): point is MapPoint => point !== null,
    );
    fitToPoints(map, targets, true, topInsetPx, bottomInsetRatio);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit recenter trigger
  }, [focusKey]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full [&_.leaflet-tile-pane]:grayscale [&_.leaflet-tile-pane]:brightness-105 [&_.leaflet-tile-pane]:contrast-90"
    />
  );
}
