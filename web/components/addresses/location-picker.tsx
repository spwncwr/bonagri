"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";

export type PickerPoint = { lat: number; lng: number };

// Reverse/search-geocoded description of the pinned place. Consumers decide
// what to do with it — the picker never writes address fields by itself.
export type GeocodedPlace = {
  displayName: string;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
};

type NominatimAddress = Record<string, string | undefined>;

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
  address?: NominatimAddress;
};

type Props = {
  lat: number | null;
  lng: number | null;
  // Fired for every way a pin is chosen (map click, drag, search, GPS).
  // null is never emitted here — clearing is a consumer's explicit action.
  onChange: (point: PickerPoint) => void;
  // Latest reverse-geocode of the current pin (null while unknown/failed).
  onResolved?: (place: GeocodedPlace | null) => void;
  className?: string;
};

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Keyless Nominatim — same keyless OSM stack as the tiles and OSRM routing.
// Usage policy asks for max ~1 request/second: search fires on submit, the
// reverse lookup is debounced (see REVERSE_DEBOUNCE_MS).
const NOMINATIM = "https://nominatim.openstreetmap.org";
const REVERSE_DEBOUNCE_MS = 700;

// Limpopo-first framing (BonAgri's focus region) when there is no pin yet.
const DEFAULT_VIEW: [number, number] = [-23.9, 29.7];
const DEFAULT_ZOOM = 8;

function placeFromNominatim(
  address: NominatimAddress,
  displayName: string,
): GeocodedPlace {
  const house = address.house_number;
  const road =
    address.road ??
    address.pedestrian ??
    address.neighbourhood ??
    address.suburb ??
    address.hamlet ??
    "";
  const street = [house, road].filter(Boolean).join(" ");

  return {
    displayName,
    addressLine1: street || displayName,
    city:
      address.city ??
      address.town ??
      address.village ??
      address.municipality ??
      address.county ??
      "",
    province: address.state ?? address.province ?? "",
    postalCode: address.postcode ?? "",
    country: address.country ?? "",
  };
}

function isValidPoint(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function pinIcon(L: typeof import("leaflet")) {
  return L.divIcon({
    className: "",
    iconSize: [42, 42],
    iconAnchor: [21, 40],
    html: `<div style="position:relative;width:42px;height:42px;display:flex;align-items:flex-start;justify-content:center">
      <span style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#17633a;border:3px solid #fff;box-shadow:0 5px 14px rgba(23,37,27,.45)"></span>
      <span style="position:absolute;top:8px;width:8px;height:8px;border-radius:50%;background:#fff"></span>
    </div>`,
  });
}

export default function LocationPicker({
  lat,
  lng,
  onChange,
  onResolved,
  className = "",
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markerRef = useRef<Marker | null>(null);
  // Set when the pin came from a source that already carries an address
  // (search result) so the debounced reverse lookup doesn't duplicate it.
  const skipReverseRef = useRef(false);
  // Key of the pin currently being reverse-geocoded (stale responses drop).
  const pinnedKeyRef = useRef("");
  const onResolvedRef = useRef(onResolved);

  useEffect(() => {
    onResolvedRef.current = onResolved;
  }, [onResolved]);

  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searchError, setSearchError] = useState("");
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  // Keyed by pin: a past failure can never be misread as the status of a
  // newly chosen pin, and no reset call is needed when the pin changes.
  const [failedPinKey, setFailedPinKey] = useState<string | null>(null);

  const pinKey = lat != null && lng != null ? `${lat},${lng}` : "";
  const lookupFailed = pinKey !== "" && failedPinKey === pinKey;

  // ── Map lifecycle (same dynamic-import pattern as transport/live-map) ──
  useEffect(() => {
    let disposed = false;

    void (async () => {
      const L = await import("leaflet");
      if (disposed || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView(
        lat != null && lng != null ? [lat, lng] : DEFAULT_VIEW,
        lat != null && lng != null ? 14 : DEFAULT_ZOOM,
      );

      L.tileLayer(TILE_URL, {
        attribution: ATTRIBUTION,
        maxZoom: 19,
      }).addTo(map);

      leafletRef.current = L;
      mapRef.current = map;

      map.on("click", (event: { latlng: { lat: number; lng: number } }) => {
        const point = { lat: event.latlng.lat, lng: event.latlng.lng };
        if (!isValidPoint(point.lat, point.lng)) return;
        skipReverseRef.current = false;
        onChange(point);
      });

      setReady(true);
      window.setTimeout(() => map.invalidateSize(), 80);
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
      markerRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  // ── Keep the marker in sync with the controlled pin ──
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    if (lat == null || lng == null || !isValidPoint(lat, lng)) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    if (!markerRef.current) {
      markerRef.current = L.marker([lat, lng], {
        icon: pinIcon(L),
        title: "Delivery destination",
        draggable: true,
        keyboard: false,
      }).addTo(map);

      markerRef.current.on("dragend", () => {
        const position = markerRef.current?.getLatLng();
        if (!position) return;
        if (!isValidPoint(position.lat, position.lng)) return;
        skipReverseRef.current = false;
        onChange({ lat: position.lat, lng: position.lng });
      });

      map.setView([lat, lng], Math.max(map.getZoom(), 14), { animate: false });
    } else {
      const current = markerRef.current.getLatLng();
      if (current.lat !== lat || current.lng !== lng) {
        markerRef.current.setLatLng([lat, lng]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to controlled pin
  }, [ready, lat, lng]);

  // ── Debounced reverse geocode of the pin (never blocks the consumer) ──
  // State changes only inside the timer/async callbacks; a stale response
  // for a previous pin is dropped via pinnedKeyRef.
  useEffect(() => {
    if (lat == null || lng == null) return;

    if (skipReverseRef.current) {
      skipReverseRef.current = false;
      return;
    }

    const key = `${lat},${lng}`;
    pinnedKeyRef.current = key;

    const controller = new AbortController();
    let cancelled = false;

    const timer = window.setTimeout(() => {
      setLookingUp(true);

      void (async () => {
        try {
          const response = await fetch(
            `${NOMINATIM}/reverse?format=jsonv2&zoom=18&addressdetails=1` +
              `&lat=${lat}&lon=${lng}`,
            { signal: controller.signal },
          );
          if (!response.ok) throw new Error(`reverse ${response.status}`);
          const data = (await response.json()) as {
            display_name?: string;
            address?: NominatimAddress;
          };
          if (!data.display_name) throw new Error("no display_name");

          if (cancelled || pinnedKeyRef.current !== key) return;

          const place = placeFromNominatim(
            data.address ?? {},
            data.display_name,
          );
          setFailedPinKey(null);
          onResolvedRef.current?.(place);
        } catch (error) {
          if ((error as Error)?.name === "AbortError" || cancelled) return;
          if (pinnedKeyRef.current !== key) return;
          // Geocoding failure is never fatal: the pin stays, typing works.
          setFailedPinKey(key);
          onResolvedRef.current?.(null);
        } finally {
          setLookingUp(false);
        }
      })();
    }, REVERSE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [lat, lng]);

  async function runSearch() {
    const q = query.trim();
    if (q.length < 3 || searching) return;

    setSearching(true);
    setSearchError("");
    setResults([]);

    try {
      const response = await fetch(
        `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=5` +
          `&countrycodes=za&q=${encodeURIComponent(q)}`,
      );
      if (!response.ok) throw new Error(`search ${response.status}`);
      const rows = (await response.json()) as NominatimResult[];

      if (!rows.length) {
        setSearchError("No matching places found — try a fuller address.");
      }
      setResults(rows);
    } catch {
      setSearchError("Place search is unavailable right now — drop a pin instead.");
    } finally {
      setSearching(false);
    }
  }

  function pickResult(result: NominatimResult) {
    const point = {
      lat: Number.parseFloat(result.lat),
      lng: Number.parseFloat(result.lon),
    };
    if (!isValidPoint(point.lat, point.lng)) return;

    // The search result already carries an address — skip the reverse call.
    skipReverseRef.current = true;
    onChange(point);
    setResults([]);
    setQuery("");
    setSearchError("");
    onResolvedRef.current?.(
      placeFromNominatim(result.address ?? {}, result.display_name),
    );

    mapRef.current?.setView([point.lat, point.lng], 15, { animate: true });
  }

  function useMyCurrentLocation() {
    if (locating) return;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError(
        "Location is not available in this browser — drop a pin on the map instead.",
      );
      return;
    }

    setLocating(true);
    setGpsError("");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        if (!isValidPoint(point.lat, point.lng)) {
          setGpsError(
            "Got an unreadable location fix — drop a pin on the map instead.",
          );
          return;
        }
        // Never treated as the destination on its own: the pin appears for
        // confirmation, and only the consumer's save action confirms it.
        skipReverseRef.current = false;
        onChange(point);
        mapRef.current?.setView([point.lat, point.lng], 16, { animate: true });
      },
      (error) => {
        setLocating(false);
        setGpsError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission denied — drop a pin on the map instead."
            : error.code === error.TIMEOUT
              ? "Location request timed out — try again or drop a pin on the map."
              : "Couldn't get your location — drop a pin on the map instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className={className}>
      {/* Place search — a div, not a <form>: the picker is embedded inside
          the address form and HTML forbids nested forms. */}
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void runSearch();
            }
          }}
          maxLength={200}
          aria-label="Search for a place"
          placeholder="Search a place (e.g. 18 Delta St, Tzaneen)"
          className="min-w-0 flex-1 rounded-lg border border-[#dce2d9] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={searching || query.trim().length < 3}
          className="shrink-0 rounded-lg border border-[#17633a] px-3.5 py-2.5 text-xs font-black text-[#17633a] transition hover:bg-[#eaf2e8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      {searchError ? (
        <p className="mt-2 text-xs text-red-600">{searchError}</p>
      ) : null}

      {results.length > 0 ? (
        <ul className="mt-2 divide-y divide-[#e9ede7] overflow-hidden rounded-lg border border-[#dce2d9] bg-white">
          {results.map((result) => (
            <li key={`${result.lat}:${result.lon}`}>
              <button
                type="button"
                onClick={() => pickResult(result)}
                className="w-full px-3 py-2.5 text-left text-xs leading-4 text-[#344238] transition hover:bg-[#f7f8f4]"
              >
                {result.display_name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Map */}
      <div
        ref={containerRef}
        className="mt-2 h-56 w-full overflow-hidden rounded-xl border border-[#dce2d9] bg-[#eef1ec] sm:h-64"
      />
      {!ready ? (
        <p className="mt-2 text-xs text-[#69756c]">Loading map…</p>
      ) : null}

      {/* Actions */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={useMyCurrentLocation}
          disabled={locating}
          className="rounded-lg bg-[#17633a] px-3.5 py-2 text-xs font-black text-white transition hover:bg-[#12512f] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {locating ? "Locating…" : "Use my current location"}
        </button>

        <span className="text-[11px] leading-4 text-[#69756c]">
          {lat != null && lng != null
            ? `Pin set: ${lat.toFixed(5)}, ${lng.toFixed(5)}`
            : "Tap the map to drop a pin."}
        </span>
      </div>

      {gpsError ? <p className="mt-2 text-xs text-red-600">{gpsError}</p> : null}

      {lat != null && lng != null ? (
        <p className="mt-2 text-xs leading-5 text-[#344238]">
          {lookingUp
            ? "Reading this location's address…"
            : lookupFailed
              ? "Couldn't read this location's address — you can still type it manually."
              : "Confirm this is the delivery destination, then save."}
        </p>
      ) : null}
    </div>
  );
}
