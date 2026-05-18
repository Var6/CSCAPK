// Free map services: OSM tiles, Nominatim geocoding, OSRM routing.
// No API keys required. Respect usage policies for free tiers.

export interface GeocodeResult {
  display_name: string;
  lat: number;
  lng: number;
}

const UA = 'CSCTravelApp/1.0 (booking@csctravels.com)';

export async function searchPlaces(query: string, opts?: { lat?: number; lng?: number }): Promise<GeocodeResult[]> {
  if (!query.trim() || query.trim().length < 3) return [];

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    addressdetails: '0',
    limit: '6',
    countrycodes: 'in',
  });

  if (opts?.lat && opts?.lng) {
    // Bias results around the user's current position (10km box).
    const delta = 0.1;
    params.set('viewbox', `${opts.lng - delta},${opts.lat + delta},${opts.lng + delta},${opts.lat - delta}`);
    params.set('bounded', '0');
  }

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
    });
    if (!res.ok) return [];
    const data = await res.json() as Array<{ display_name: string; lat: string; lon: string }>;
    return data.map((d) => ({
      display_name: d.display_name,
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
    }));
  } catch (e) {
    console.warn('Nominatim search failed', e);
    return [];
  }
}

export interface Route {
  distanceKm: number;
  durationMin: number;
  geometry: Array<{ latitude: number; longitude: number }>;
}

export async function routeBetween(
  pickup: { lat: number; lng: number },
  drop: { lat: number; lng: number },
): Promise<Route | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${drop.lng},${drop.lat}?overview=full&geometries=geojson`;
  try {
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
  } catch (e) {
    console.warn('OSRM route failed', e);
    return null;
  }
}
