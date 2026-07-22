// Live rate card.
//
// Single source of truth for every price shown in the app. The card is served by
// the CSCBilling backend (GET {API_URL}/api/rates) so management can revise fares
// without shipping a new APK. If the network is down or the endpoint is not live
// yet, we fall back to DEFAULT_RATES below, which mirrors the circular
// "Fare Structure for Intracity and Outstation Travel" issued by
// CSC Travels Services Pvt. Ltd.
//
// See server-reference/rates-route.ts for a drop-in Next.js handler.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, BILLING_URL } from './api';

export type VehicleClass = 'hatchback' | 'sedan' | 'suv' | 'traveller' | 'bus';

export type RiderTier = 'public' | 'member' | 'official';

export interface VehicleSpec {
  id: VehicleClass;
  label: string;
  /** e.g. "Swift, WagonR" — shown under the label. */
  examples: string;
  seats: number;
  icon: string; // Ionicons name
}

export interface HourlyPackage {
  id: string;
  label: string;
  hours: number;
  /** Package price per vehicle class. Missing class = not offered. */
  price: Partial<Record<VehicleClass, number>>;
  includes: string[];
  excludes: string[];
}

export interface RentalPackage {
  id: string;
  label: string;
  hours: number;
  includedKm: number;
  /** Self-drive price per vehicle class. Missing class = not offered. */
  price: Partial<Record<VehicleClass, number>>;
}

export interface RentalHub {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** 24h clock, e.g. "06:00" / "22:00" */
  opensAt: string;
  closesAt: string;
}

export interface RateCard {
  /** Bumped by management on every revision. Shown in the UI footer. */
  version: string;
  effectiveFrom: string;
  currency: 'INR';

  city: {
    /** ₹ per km on running metre reading. */
    perKm: number;
    /** ₹ per km charged for the empty return leg of a one-way city ride. */
    returnEmptyPerKm: number;
    minKm: number;
    minFare: number;
  };

  outstation: {
    /** ₹ per km by vehicle class. A class absent here is not offered outstation. */
    perKm: Partial<Record<VehicleClass, number>>;
    /** Charged per night the driver stays out, subject to management approval. */
    nightStayCharge: number;
  };

  hourly: HourlyPackage[];

  rental: {
    packages: RentalPackage[];
    securityDeposit: Partial<Record<VehicleClass, number>>;
    extraKm: Partial<Record<VehicleClass, number>>;
    extraHour: Partial<Record<VehicleClass, number>>;
    fuelPolicy: string;
    hubs: RentalHub[];
    /** Minimum age / licence rules surfaced before checkout. */
    requirements: string[];
  };

  /** Percentage off the *base fare* only, per the benefit-discount circular. */
  discounts: Record<RiderTier, { pct: number; label: string; proof: string }>;

  vehicles: VehicleSpec[];

  /** Free-form lines rendered under every fare breakdown. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Bundled fallback — mirrors the issued circular.
// ---------------------------------------------------------------------------

export const DEFAULT_RATES: RateCard = {
  version: 'bundled-2026-07',
  effectiveFrom: '2026-07-01',
  currency: 'INR',

  city: {
    perKm: 20,
    returnEmptyPerKm: 8.5,
    minKm: 3,
    minFare: 100,
  },

  outstation: {
    // Only the two classes the circular names explicitly.
    perKm: { hatchback: 12, sedan: 14 },
    nightStayCharge: 500,
  },

  hourly: [
    {
      id: 'pkg-8h',
      label: '8 Hours — Vehicle Only',
      hours: 8,
      // Circular quotes ₹1400–₹1800 "depends on vehicle type".
      price: { hatchback: 1400, sedan: 1600, suv: 1800 },
      includes: ['Vehicle'],
      excludes: ['Driver', 'Fuel', 'Toll', 'Parking'],
    },
  ],

  rental: {
    packages: [
      { id: 'sd-8h', label: '8 Hours', hours: 8, includedKm: 80, price: { hatchback: 1400, sedan: 1600, suv: 1800 } },
      { id: 'sd-12h', label: '12 Hours', hours: 12, includedKm: 120, price: { hatchback: 1900, sedan: 2200, suv: 2500 } },
      { id: 'sd-24h', label: '24 Hours', hours: 24, includedKm: 200, price: { hatchback: 2800, sedan: 3200, suv: 3700 } },
      { id: 'sd-weekly', label: '7 Days', hours: 168, includedKm: 1200, price: { hatchback: 16000, sedan: 19000, suv: 22000 } },
    ],
    securityDeposit: { hatchback: 2000, sedan: 3000, suv: 4000 },
    extraKm: { hatchback: 9, sedan: 11, suv: 13 },
    extraHour: { hatchback: 180, sedan: 220, suv: 260 },
    fuelPolicy: 'Fuel is not included. Return the vehicle at the same fuel level as pickup.',
    hubs: [
      { id: 'hub-patna-jn', name: 'Patna Junction Hub', address: 'Near Patna Junction, Patna 800001', lat: 25.6017, lng: 85.1370, opensAt: '06:00', closesAt: '22:00' },
      { id: 'hub-boring', name: 'Boring Road Hub', address: 'Boring Road, Patna 800001', lat: 25.6122, lng: 85.1189, opensAt: '07:00', closesAt: '21:00' },
      { id: 'hub-airport', name: 'Jay Prakash Narayan Airport', address: 'Airport Road, Patna 800014', lat: 25.5913, lng: 85.0880, opensAt: '05:00', closesAt: '23:00' },
    ],
    requirements: [
      'Valid driving licence held for at least 1 year',
      'Original ID proof at the time of pickup',
      'Refundable security deposit blocked at pickup',
    ],
  },

  discounts: {
    public: { pct: 0, label: 'Regular', proof: '' },
    member: { pct: 10, label: 'Cooperative Member', proof: 'Membership ID required at pickup' },
    official: { pct: 25, label: 'Official / Employee', proof: 'Official authorisation required; subject to management approval' },
  },

  vehicles: [
    { id: 'hatchback', label: 'Hatchback', examples: 'Swift, WagonR, i10', seats: 4, icon: 'car-outline' },
    { id: 'sedan', label: 'Sedan', examples: 'Dzire, Aura, Amaze', seats: 4, icon: 'car-sport-outline' },
    { id: 'suv', label: 'SUV', examples: 'Ertiga, Innova', seats: 6, icon: 'car' },
    { id: 'traveller', label: 'Traveller', examples: 'Force Traveller', seats: 12, icon: 'bus-outline' },
    { id: 'bus', label: 'Bus', examples: '30+ seater', seats: 32, icon: 'bus' },
  ],

  notes: [
    'Fuel and vehicle maintenance are included in the applicable fare calculation.',
    'Toll tax, parking fees and night stay charges are billed separately on actuals.',
    'Fixed rate — no surge pricing. Final bill follows the vehicle meter reading.',
  ],
};

// ---------------------------------------------------------------------------
// Fetch + cache
// ---------------------------------------------------------------------------

const CACHE_KEY = 'csctravel.rates.v1';
/** Serve cache instantly, revalidate in the background after this long. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

interface CachedRates {
  fetchedAt: number;
  card: RateCard;
}

/** Guards against a malformed/partial payload nuking pricing in the app. */
function isUsable(card: unknown): card is RateCard {
  const c = card as RateCard | null;
  return (
    !!c &&
    typeof c.version === 'string' &&
    !!c.city &&
    typeof c.city.perKm === 'number' &&
    c.city.perKm > 0 &&
    !!c.outstation &&
    !!c.discounts
  );
}

/** Backend may send a partial card; fill every gap from the bundled circular. */
function merge(remote: Partial<RateCard>): RateCard {
  const d = DEFAULT_RATES;
  return {
    ...d,
    ...remote,
    city: { ...d.city, ...remote.city },
    outstation: {
      ...d.outstation,
      ...remote.outstation,
      perKm: { ...d.outstation.perKm, ...remote.outstation?.perKm },
    },
    hourly: remote.hourly?.length ? remote.hourly : d.hourly,
    rental: {
      ...d.rental,
      ...remote.rental,
      packages: remote.rental?.packages?.length ? remote.rental.packages : d.rental.packages,
      hubs: remote.rental?.hubs?.length ? remote.rental.hubs : d.rental.hubs,
      securityDeposit: { ...d.rental.securityDeposit, ...remote.rental?.securityDeposit },
      extraKm: { ...d.rental.extraKm, ...remote.rental?.extraKm },
      extraHour: { ...d.rental.extraHour, ...remote.rental?.extraHour },
    },
    discounts: { ...d.discounts, ...remote.discounts },
    vehicles: remote.vehicles?.length ? remote.vehicles : d.vehicles,
    notes: remote.notes?.length ? remote.notes : d.notes,
  };
}

export async function readCachedRates(): Promise<CachedRates | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRates;
    return isUsable(parsed?.card) ? parsed : null;
  } catch {
    return null;
  }
}

/** Hits CSCBilling. Throws on any failure so callers can keep the cached card. */
export async function fetchRates(): Promise<RateCard> {
  const res = await api<{ rates?: Partial<RateCard> } & Partial<RateCard>>('/api/rates', {
    method: 'GET',
    auth: false,
    // The rate card is published by the billing console, not the customer site.
    baseUrl: BILLING_URL,
  });
  const payload = (res.rates ?? res) as Partial<RateCard>;
  const card = merge(payload);
  if (!isUsable(card)) throw new Error('Rate card from server is malformed');
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), card } satisfies CachedRates));
  return card;
}

export const ratesAreStale = (fetchedAt: number) => Date.now() - fetchedAt > STALE_AFTER_MS;
