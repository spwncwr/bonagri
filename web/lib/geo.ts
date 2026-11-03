export type GeoPoint = { lat: number; lng: number };

/*
 * Orders still store the destination as free-text city, so a delivery without
 * an exact pin is drawn at the city centre and flagged as approximate.
 */
export const CITY_CENTRES: Record<string, GeoPoint> = {
  polokwane: { lat: -23.9045, lng: 29.4689 },
  tzaneen: { lat: -23.8333, lng: 30.1667 },
  giyani: { lat: -23.3167, lng: 30.7167 },
  musina: { lat: -22.3488, lng: 30.0396 },
  thohoyandou: { lat: -22.9456, lng: 30.4849 },
  mokopane: { lat: -24.1944, lng: 29.0097 },
  lephalale: { lat: -23.6667, lng: 27.7333 },
  phalaborwa: { lat: -23.942, lng: 31.1411 },
  louistrichardt: { lat: -23.0438, lng: 29.9025 },
  makhado: { lat: -23.0438, lng: 29.9025 },
  belabela: { lat: -24.8833, lng: 28.2833 },
  modimolle: { lat: -24.7, lng: 28.4 },
  johannesburg: { lat: -26.2041, lng: 28.0473 },
  joburg: { lat: -26.2041, lng: 28.0473 },
  pretoria: { lat: -25.7479, lng: 28.2293 },
  centurion: { lat: -25.8603, lng: 28.1894 },
  midrand: { lat: -25.9992, lng: 28.1263 },
  mbombela: { lat: -25.4753, lng: 30.9694 },
  nelspruit: { lat: -25.4753, lng: 30.9694 },
  rustenburg: { lat: -25.6544, lng: 27.2558 },
  mahikeng: { lat: -25.85, lng: 25.6333 },
  kimberley: { lat: -28.7282, lng: 24.7499 },
  bloemfontein: { lat: -29.0852, lng: 26.1596 },
  durban: { lat: -29.8587, lng: 31.0218 },
  pietermaritzburg: { lat: -29.6006, lng: 30.3794 },
  eastlondon: { lat: -33.0292, lng: 27.8546 },
  gqeberha: { lat: -33.9608, lng: 25.6022 },
  portelizabeth: { lat: -33.9608, lng: 25.6022 },
  capetown: { lat: -33.9249, lng: 18.4241 },
  george: { lat: -33.9646, lng: 22.4617 },
  upington: { lat: -28.4477, lng: 21.2561 },
};

export function normalizeCity(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

export function resolvePoint(
  lat: number | null | undefined,
  lng: number | null | undefined,
  city: string | null | undefined,
): { point: GeoPoint | null; approximate: boolean } {
  if (lat != null && lng != null) {
    return { point: { lat, lng }, approximate: false };
  }

  if (city) {
    const centre = CITY_CENTRES[normalizeCity(city)];
    if (centre) return { point: centre, approximate: true };
  }

  return { point: null, approximate: false };
}
