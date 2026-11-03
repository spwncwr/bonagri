/*
 * Brand artwork lives in /public/brand. Use <BrandLogo> for the horizontal
 * lockup (wordmark included) and <BrandIcon> for the rounded app mark that
 * replaces the old letter badges.
 */
/* eslint-disable @next/next/no-img-element -- fixed-size static PNGs, no optimizer needed */
const LOGO_SRC = "/brand/bonagri-logo.png";
const ICON_SRC = "/brand/bonagri-icon.png";

export function BrandLogo({
  height = 28,
  className = "",
}: {
  height?: number;
  className?: string;
}) {
  return (
    <img
      src={LOGO_SRC}
      alt="BonAgri"
      width={Math.round((height * 2400) / 886)}
      height={height}
      style={{ height, width: "auto" }}
      className={className}
    />
  );
}

export function BrandIcon({
  size = 40,
  className = "",
  alt = "",
}: {
  size?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src={ICON_SRC}
      alt={alt}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`shrink-0 object-cover ${className}`}
    />
  );
}
