"use client";

/* eslint-disable @next/next/no-img-element -- fixed-size static PNG, no optimizer needed */

import { useEffect, useState } from "react";

const HOLD_MS = 1400;
const FADE_MS = 450;

export default function SplashScreen() {
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const fadeTimer = window.setTimeout(() => setFading(true), HOLD_MS);
    const goneTimer = window.setTimeout(() => {
      document.body.style.overflow = previousOverflow;
      setGone(true);
    }, HOLD_MS + FADE_MS);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(fadeTimer);
      window.clearTimeout(goneTimer);
    };
  }, []);

  if (gone) return null;

  return (
    <div
      role="status"
      aria-label="BonAgri is loading"
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-[linear-gradient(150deg,#082f1a_0%,#0d4225_50%,#115331_100%)] transition-opacity duration-[450ms] ease-out ${
        fading ? "opacity-0" : "opacity-100"
      }`}
    >
      <img
        src="/brand/bonagri-logo-reversed.png"
        alt="BonAgri"
        width={320}
        height={118}
        className="w-[78%] max-w-[320px]"
      />
    </div>
  );
}
