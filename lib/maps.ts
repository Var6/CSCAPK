// Place search and routing, provider-agnostic.
//
// Uses Google Places/Directions when configured (see lib/google.ts), and falls
// back to Nominatim + OSRM otherwise so the app still works on a fresh clone
// with no keys. Screens only ever talk to this module.

import {
  autocomplete,
  directions,
  newSessionToken,
  placeDetails,
  proxyAvailable,
  type LatLng,
  type PlaceSuggestion,
  type RouteResult,
} from './google';

export type { LatLng, PlaceSuggestion, RouteResult };
export { newSessionToken };

export interface ResolvedPlace {
  name: string;
  lat: number;
  lng: number;
}

const UA = 'CSCTravelApp/1.0 (booking@csctravels.com)';

// ---------------------------------------------------------------------------
// OSM fallback
// ---------------------------------------------------------------------------

async function osmSearch(query: string, near?: LatLng | null): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    addressdetails: '0',
    limit: '6',
    countrycodes: 'in',
  });

  if (near) {
    const delta = 0.5;
    params.set('viewbox', `${near.lng - delta},${near.lat + delta},${near.lng + delta},${near.lat - delta}`);
    params.set('bounded', '0');
  }

  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
  });
  if (!res.ok) return [];

  const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string; place_id: number }>;
  return data.map((d) => {
    const [head, ...rest] = d.display_name.split(',');
    return {
      id: `osm:${d.place_id}`,
      primary: head.trim(),
      secondary: rest.slice(0, 3).join(',').trim(),
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
    };
  });
}

async function osrmRoute(from: LatLng, to: LatLng): Promise<RouteResult | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;

  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;

  const data = await res.json();
  const r = data.routes?.[0];
  if (!r) return null;

  return {
    distanceKm: r.distance / 1000,
    durationMin: r.duration / 60,
    geometry: (r.geometry.coordinates as [number, number][]).map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function searchPlaces(
  query: string,
  opts: { sessionToken: string; near?: LatLng | null },
): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  if (proxyAvailable()) {
    try {
      const hits = await autocomplete(q, opts);
      if (hits.length) return hits;
    } catch (e) {
      // A proxy/quota problem should degrade to OSM, not break search.
      console.warn('Google autocomplete failed, falling back to OSM', e);
    }
  }

  try {
    return await osmSearch(q, opts.near);
  } catch (e) {
    console.warn('Place search failed', e);
    return [];
  }
}

export async function resolvePlace(
  suggestion: PlaceSuggestion,
  sessionToken: string,
): Promise<ResolvedPlace | null> {
  // OSM suggestions already carry coordinates.
  if (typeof suggestion.lat === 'number' && typeof suggestion.lng === 'number') {
    return {
      name: [suggestion.primary, suggestion.secondary].filter(Boolean).join(', '),
      lat: suggestion.lat,
      lng: suggestion.lng,
    };
  }

  try {
    const details = await placeDetails(suggestion.id, sessionToken);
    if (!details) return null;
    return {
      name: suggestion.primary || details.name,
      lat: details.lat,
      lng: details.lng,
    };
  } catch (e) {
    console.warn('Place details failed', e);
    return null;
  }
}

export async function routeBetween(from: LatLng, to: LatLng): Promise<RouteResult | null> {
  let google: RouteResult | null = null;

  if (proxyAvailable()) {
    try {
      google = await directions(from, to);
    } catch (e) {
      console.warn('Google directions failed, falling back to OSRM', e);
    }
  }

  // Full Google result — road distance and a drawable line.
  if (google?.geometry.length) return google;

  let osrm: RouteResult | null = null;
  try {
    osrm = await osrmRoute(from, to);
  } catch (e) {
    console.warn('Routing failed', e);
  }

  // Distance Matrix answered but carries no geometry. Google's road distance is
  // what the fare is built on, so keep it and borrow only the line from OSRM.
  if (google) {
    return { ...google, geometry: osrm?.geometry ?? [] };
  }

  return osrm;
}

/** Straight-line km — used to decide whether a trip has left the city. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Patna city centre — the reference point for the intracity/outstation split. */
export const CITY_CENTRE: LatLng = { lat: 25.5941, lng: 85.1376 };
export const CITY_RADIUS_KM = 25;

/** Suggests the trip category so the rider doesn't have to know the rule. */
export function looksOutstation(drop: LatLng): boolean {
  return haversineKm(CITY_CENTRE, drop) > CITY_RADIUS_KM;
}
