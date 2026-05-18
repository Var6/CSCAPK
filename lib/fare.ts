// Fare rules mirror /Services page on the website.
export type TripKind = 'city' | 'outstation' | 'one_way' | 'hourly';
export type VehicleKind = 'car' | 'bus' | 'traveler';

interface FareInput {
  distanceKm: number;
  tripKind: TripKind;
  vehicle: VehicleKind;
  discountPct?: number;
}

const VEHICLE_MULTIPLIER: Record<VehicleKind, number> = {
  car: 1.0,
  bus: 1.8,
  traveler: 1.3,
};

const HOURLY_PACKAGE = 1600; // mid-point of ₹1400-₹1800

export interface FareBreakdown {
  base: number;
  vehicleMultiplier: number;
  preDiscount: number;
  discountPct: number;
  discountAmount: number;
  total: number;
}

export function estimateFare({ distanceKm, tripKind, vehicle, discountPct = 0 }: FareInput): FareBreakdown {
  const mult = VEHICLE_MULTIPLIER[vehicle];

  let base = 0;
  if (tripKind === 'city') base = distanceKm * 20;
  else if (tripKind === 'outstation') base = distanceKm * 12;
  else if (tripKind === 'one_way') base = distanceKm * 20 + distanceKm * 8.5;
  else base = HOURLY_PACKAGE;

  const preDiscount = Math.round(base * mult);
  const discountAmount = Math.round((preDiscount * discountPct) / 100);
  return {
    base: Math.round(base),
    vehicleMultiplier: mult,
    preDiscount,
    discountPct,
    discountAmount,
    total: preDiscount - discountAmount,
  };
}

export const formatINR = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
