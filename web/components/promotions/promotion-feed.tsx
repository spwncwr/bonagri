"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchPromotions,
  type PromoPlacement,
  type PublicPromotion,
} from "../../lib/promotions";
import PromotionCard from "./promotion-card";

// A slot in the marketplace feed. Fetches only the campaigns configured for
// this placement; any failure (API down, no campaigns) silently renders
// nothing so promotions can never break browsing.
export default function PromotionFeed({
  placement,
  className = "",
  label,
}: {
  placement: PromoPlacement;
  className?: string;
  label?: string;
}) {
  const [promotions, setPromotions] = useState<PublicPromotion[]>([]);
  const [location, setLocation] = useState<{ city?: string; lat?: number; lng?: number }>({});
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();

    fetchPromotions(placement, location, controller.signal)
      .then((data) => {
        if (requestId.current === id) setPromotions(data);
      })
      .catch(() => {
        // Keep whatever is already on screen; a failed refresh is not a crash.
      });

    return () => controller.abort();
  }, [placement, location]);

  const handleLocationChange = useCallback((city: string) => {
    setLocationError("");
    setLocation({ city });
  }, []);

  const handleUseLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError("Location is not available in this browser.");
      return;
    }

    setLocating(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: Number(position.coords.latitude.toFixed(4)),
          lng: Number(position.coords.longitude.toFixed(4)),
        });
        setLocating(false);
      },
      () => {
        setLocationError("We could not get your location. Pick an area instead.");
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }, []);

  if (promotions.length === 0) return null;

  return (
    <section
      aria-label={label ?? "Promotions"}
      className={className}
    >
      {label ? (
        <h2 className="mb-2.5 px-1 text-sm font-black tracking-tight text-[#17251b]">
          {label}
        </h2>
      ) : null}

      <div className="space-y-4">
        {promotions.map((promotion) => (
          <PromotionCard
            key={promotion.id}
            promotion={promotion}
            locating={locating}
            locationError={locationError}
            onLocationChange={handleLocationChange}
            onUseLocation={handleUseLocation}
          />
        ))}
      </div>
    </section>
  );
}
