// Google Places + Directions, always via the CSCBilling proxy.
//
// The app holds NO Google web-service key. Places/Directions/Distance Matrix
// keys cannot be restricted to an app package — Google only supports IP
// restriction on them — so a key shipped in the binary is extractable and
// billable by anyone. Those calls go to CSCBilling (/api/maps/*), which holds
// the key server-side. See CSCBilling/lib/mapsProxy.ts.
//
// The Maps SDK keys in app.config.js are a different thing entirely: they only
// render the map, and they ARE restricted by package name + signing cert.
//
// If the proxy is unreachable (not deployed yet, offline, throttled) every
// function here throws and lib/maps.ts falls back to Nominatim/OSRM.

import { api, BILLING_URL } from './api';

export interface PlaceSuggestion {
  /** Google place_id, or a synthesised id for non-Google providers. */
  id: string;
  /** Bold first line, e.g. "Patna Junction". */
  primary: string;
  /** Grey second line, e.g. "Patna, Bihar, India". */
  secondary: string;
  /** Present when the provider already resolved coordinates (OSM does). */
  lat?: number;
  lng?: number;
}

export interface LatLng { lat: number; lng: number }

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  geometry: Array<{ latitude: number; longitude: number }>;
}

// ---------------------------------------------------------------------------
// Circuit breaker
//
// Until the /api/maps routes are deployed, every lookup would otherwise pay a
// full round-trip to a 404 before falling back. After a few consecutive
// failures we stop trying for a while and go straight to the OSM path.
// ---------------------------------------------------------------------------

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60 * 1000;

let consecutiveFailures = 0;
let openUntil = 0;

export function proxyAvailable(): boolean {
  return Date.now() >= openUntil;
}

function noteSuccess() {
  consecutiveFailures = 0;
  openUntil = 0;
}

function noteFailure() {
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    openUntil = Date.now() + COOLDOWN_MS;
    consecutiveFailures = 0;
    console.warn(`[maps] proxy unhealthy — using OSM fallback for the next ${COOLDOWN_MS / 60000} min`);
  }
}

async function proxy<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!proxyAvailable()) throw new Error('maps proxy circuit open');
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await api<T>(`/api/maps/${path}?${qs}`, {
      method: 'GET',
      auth: false,
      baseUrl: BILLING_URL,
    });
    noteSuccess();
    return res;
  } catch (e) {
    noteFailure();
    throw e;
  }
}

/**
 * Autocomplete sessions bill as one request instead of per-keystroke.
 * Start one when the user focuses a field, and pass the same token to the
 * matching placeDetails() call to close it.
 */
export function newSessionToken(): string {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface AutocompleteResponse {
  predictions?: Array<{
    place_id: string;
    structured_formatting?: { main_text?: string; secondary_text?: string };
    description?: string;
  }>;
}

export async function autocomplete(
  input: string,
  opts: { sessionToken: string; near?: LatLng | null },
): Promise<PlaceSuggestion[]> {
  const params: Record<string, string> = { input, sessiontoken: opts.sessionToken };
  if (opts.near) params.location = `${opts.near.lat},${opts.near.lng}`;

  const json = await proxy<AutocompleteResponse>('autocomplete', params);
  return (json.predictions ?? []).map((p) => ({
    id: p.place_id,
    primary: p.structured_formatting?.main_text ?? p.description ?? '',
    secondary: p.structured_formatting?.secondary_text ?? '',
  }));
}

interface PlaceDetailsResponse {
  result?: {
    name?: string;
    formatted_address?: string;
    geometry?: { location?: { lat: number; lng: number } };
  } | null;
}

export async function placeDetails(
  placeId: string,
  sessionToken: string,
): Promise<{ name: string; lat: number; lng: number } | null> {
  const json = await proxy<PlaceDetailsResponse>('place', {
    place_id: placeId,
    sessiontoken: sessionToken,
  });

  const loc = json.result?.geometry?.location;
  if (!loc) return null;

  return {
    name: json.result?.name || json.result?.formatted_address || 'Selected location',
    lat: loc.lat,
    lng: loc.lng,
  };
}

interface DirectionsResponse {
  source: 'directions' | 'distance_matrix';
  distanceMeters: number;
  durationSeconds: number;
  /** Empty when the upstream was Distance Matrix, which returns no geometry. */
  polyline: string;
}

export async function directions(origin: LatLng, dest: LatLng): Promise<RouteResult | null> {
  const json = await proxy<DirectionsResponse>('directions', {
    origin: `${origin.lat},${origin.lng}`,
    destination: `${dest.lat},${dest.lng}`,
  });

  if (!json.distanceMeters) return null;

  return {
    distanceKm: json.distanceMeters / 1000,
    durationMin: json.durationSeconds / 60,
    geometry: json.polyline ? decodePolyline(json.polyline) : [],
  };
}

/** Google's encoded polyline algorithm format. */
export function decodePolyline(encoded: string): Array<{ latitude: number; longitude: number }> {
  const points: Array<{ latitude: number; longitude: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
}
