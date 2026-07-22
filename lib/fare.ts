// Fare engine.
//
// Implements the circular "Fare Structure for Intracity and Outstation Travel"
// (CSC Travels Services Pvt. Ltd.) on top of whatever RateCard is currently
// live — see lib/rates.ts. Nothing here hardcodes a price; every number is read
// off the card so management revisions land without an app update.

import type { RateCard, RiderTier, VehicleClass } from './rates';

export type TripKind =
  | 'city_one_way'
  | 'city_round_trip'
  | 'outstation_one_way'
  | 'outstation_round_trip'
  | 'hourly';

export const TRIP_LABELS: Record<TripKind, string> = {
  city_one_way: 'City · One-way',
  city_round_trip: 'City · Round trip',
  outstation_one_way: 'Outstation · One-way',
  outstation_round_trip: 'Outstation · Round trip',
  hourly: '8 Hour Package',
};

export const isOutstation = (t: TripKind) => t.startsWith('outstation');
export const isRoundTrip = (t: TripKind) => t.endsWith('round_trip');

export interface FareLine {
  label: string;
  /** The arithmetic, spelled out — e.g. "40.0 km × ₹20". */
  detail?: string;
  amount: number;
}

export interface FareQuote {
  /** Discountable portion, per "The discount will be applicable on the base fare." */
  baseLines: FareLine[];
  baseFare: number;

  tier: RiderTier;
  discountLabel: string;
  discountPct: number;
  discountAmount: number;

  /** Billed on actuals — explicitly outside the discount. */
  extraLines: FareLine[];
  extrasTotal: number;

  total: number;
  /** True when the city minimum-fare floor was applied. */
  minimumApplied: boolean;
  notes: string[];
}

export interface FareInput {
  rates: RateCard;
  /** One-way route distance from the router, in km. */
  distanceKm: number;
  tripKind: TripKind;
  vehicle: VehicleClass;
  tier?: RiderTier;
  /** Billed on actuals, entered by ops at closing. Estimates only here. */
  tollEstimate?: number;
  parkingEstimate?: number;
  /** Nights the driver stays out (outstation only). */
  nightStays?: number;
  /** Which package, when tripKind is 'hourly'. Defaults to the first offered. */
  hourlyPackageId?: string;
}

const round = (n: number) => Math.round(n);
const km = (n: number) => `${n.toFixed(1)} km`;

/** Vehicle classes the card actually prices for the given trip kind. */
export function availableVehicles(rates: RateCard, tripKind: TripKind): VehicleClass[] {
  if (isOutstation(tripKind)) {
    return rates.vehicles.filter((v) => typeof rates.outstation.perKm[v.id] === 'number').map((v) => v.id);
  }
  if (tripKind === 'hourly') {
    const pkg = rates.hourly[0];
    return rates.vehicles.filter((v) => typeof pkg?.price[v.id] === 'number').map((v) => v.id);
  }
  // City rides are a flat per-km rate regardless of vehicle.
  return rates.vehicles.map((v) => v.id);
}

export function estimateFare(input: FareInput): FareQuote {
  const {
    rates,
    distanceKm,
    tripKind,
    vehicle,
    tier = 'public',
    tollEstimate = 0,
    parkingEstimate = 0,
    nightStays = 0,
    hourlyPackageId,
  } = input;

  const baseLines: FareLine[] = [];
  const extraLines: FareLine[] = [];
  const notes: string[] = [];
  let minimumApplied = false;

  if (tripKind === 'hourly') {
    const pkg = rates.hourly.find((p) => p.id === hourlyPackageId) ?? rates.hourly[0];
    const price = pkg?.price[vehicle];
    if (pkg && typeof price === 'number') {
      baseLines.push({ label: pkg.label, detail: `${pkg.hours} hours`, amount: price });
      if (pkg.excludes.length) notes.push(`Excludes ${pkg.excludes.join(', ').toLowerCase()}.`);
    } else {
      notes.push('This package is not offered for the selected vehicle.');
    }
  } else if (isOutstation(tripKind)) {
    const perKm = rates.outstation.perKm[vehicle];
    if (typeof perKm === 'number') {
      const chargeable = isRoundTrip(tripKind) ? distanceKm * 2 : distanceKm;
      baseLines.push({
        label: isRoundTrip(tripKind) ? 'Outstation — round trip' : 'Outstation — one-way',
        detail: `${km(chargeable)} × ₹${perKm}`,
        amount: chargeable * perKm,
      });
      notes.push('Charged on the vehicle meter reading at trip close.');
    } else {
      notes.push('Outstation travel is not offered for the selected vehicle.');
    }

    if (nightStays > 0) {
      extraLines.push({
        label: 'Driver night stay',
        detail: `${nightStays} night${nightStays > 1 ? 's' : ''} × ₹${rates.outstation.nightStayCharge}`,
        amount: nightStays * rates.outstation.nightStayCharge,
      });
      notes.push('Night stay charges apply as per management approval.');
    }
  } else if (tripKind === 'city_round_trip') {
    // Circular: "Entire journey distance will be charged at ₹20 per KM".
    const chargeable = distanceKm * 2;
    baseLines.push({
      label: 'City round trip',
      detail: `${km(chargeable)} × ₹${rates.city.perKm}`,
      amount: chargeable * rates.city.perKm,
    });
  } else {
    // city_one_way — outbound at the full rate, empty return at the return rate.
    baseLines.push({
      label: 'City ride',
      detail: `${km(distanceKm)} × ₹${rates.city.perKm}`,
      amount: distanceKm * rates.city.perKm,
    });
    baseLines.push({
      label: 'Return (empty vehicle)',
      detail: `${km(distanceKm)} × ₹${rates.city.returnEmptyPerKm}`,
      amount: distanceKm * rates.city.returnEmptyPerKm,
    });
  }

  let baseFare = round(baseLines.reduce((s, l) => s + l.amount, 0));

  // City minimum-fare floor.
  if (!isOutstation(tripKind) && tripKind !== 'hourly' && baseFare > 0 && baseFare < rates.city.minFare) {
    baseFare = rates.city.minFare;
    minimumApplied = true;
  }

  const tierCfg = rates.discounts[tier] ?? rates.discounts.public;
  const discountPct = tierCfg?.pct ?? 0;
  const discountAmount = round((baseFare * discountPct) / 100);
  if (discountPct > 0 && tierCfg.proof) notes.push(tierCfg.proof + '.');

  if (tollEstimate > 0) extraLines.push({ label: 'Toll tax', detail: 'on actuals', amount: tollEstimate });
  if (parkingEstimate > 0) extraLines.push({ label: 'Parking', detail: 'on actuals', amount: parkingEstimate });

  const extrasTotal = round(extraLines.reduce((s, l) => s + l.amount, 0));

  return {
    baseLines: baseLines.map((l) => ({ ...l, amount: round(l.amount) })),
    baseFare,
    tier,
    discountLabel: tierCfg?.label ?? 'Regular',
    discountPct,
    discountAmount,
    extraLines,
    extrasTotal,
    total: baseFare - discountAmount + extrasTotal,
    minimumApplied,
    notes: [...notes, ...rates.notes],
  };
}

export const formatINR = (n: number) =>
  '₹' + Math.round(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
