// Self-drive rental quoting.
//
// The 8-hour "Only Vehicle" package in the circular (₹1400–₹1800, excludes
// driver/fuel/toll/parking) is the self-drive product. This module extends it
// into the Vogo/Bounce-style package ladder carried on the live RateCard:
// pick a hub, pick a slot, pay for the package, and settle extra km / extra
// hours on return.

import type { RateCard, RentalPackage, RiderTier, VehicleClass } from './rates';
import type { FareLine } from './fare';

export interface RentalQuoteInput {
  rates: RateCard;
  vehicle: VehicleClass;
  packageId: string;
  startAt: Date;
  endAt: Date;
  /** Rider's own estimate; only used to preview the extra-km charge. */
  estimatedKm?: number;
  tier?: RiderTier;
}

export interface RentalQuote {
  pkg: RentalPackage | null;
  /** Hours the vehicle is actually booked out for. */
  bookedHours: number;
  /** Hours beyond the package, billed at the extra-hour rate. */
  extraHours: number;
  includedKm: number;
  extraKm: number;

  baseLines: FareLine[];
  baseFare: number;

  discountLabel: string;
  discountPct: number;
  discountAmount: number;

  /** Blocked at pickup and released on return — not part of the fare. */
  securityDeposit: number;
  /** Payable now. */
  total: number;

  unavailableReason: string | null;
  notes: string[];
}

const round = (n: number) => Math.round(n);
export const hoursBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);

/** Packages the card prices for this vehicle class. */
export function availablePackages(rates: RateCard, vehicle: VehicleClass): RentalPackage[] {
  return rates.rental.packages.filter((p) => typeof p.price[vehicle] === 'number');
}

/** Vehicle classes offered for self-drive at all. */
export function rentalVehicles(rates: RateCard): VehicleClass[] {
  return rates.vehicles
    .filter((v) => rates.rental.packages.some((p) => typeof p.price[v.id] === 'number'))
    .map((v) => v.id);
}

export function quoteRental(input: RentalQuoteInput): RentalQuote {
  const { rates, vehicle, packageId, startAt, endAt, estimatedKm = 0, tier = 'public' } = input;

  const pkg = rates.rental.packages.find((p) => p.id === packageId) ?? null;
  const packagePrice = pkg?.price[vehicle];

  const tierCfg = rates.discounts[tier] ?? rates.discounts.public;
  const deposit = rates.rental.securityDeposit[vehicle] ?? 0;

  const bookedHours = hoursBetween(startAt, endAt);
  const notes: string[] = [rates.rental.fuelPolicy];

  const empty: RentalQuote = {
    pkg,
    bookedHours,
    extraHours: 0,
    includedKm: pkg?.includedKm ?? 0,
    extraKm: 0,
    baseLines: [],
    baseFare: 0,
    discountLabel: tierCfg.label,
    discountPct: 0,
    discountAmount: 0,
    securityDeposit: deposit,
    total: 0,
    unavailableReason: null,
    notes,
  };

  if (!pkg || typeof packagePrice !== 'number') {
    return { ...empty, unavailableReason: 'This package is not available for the selected vehicle.' };
  }
  if (endAt.getTime() <= startAt.getTime()) {
    return { ...empty, unavailableReason: 'Return time must be after pickup time.' };
  }

  const baseLines: FareLine[] = [
    { label: pkg.label, detail: `${pkg.includedKm} km included`, amount: packagePrice },
  ];

  // Part hours bill as full hours — stated up front so returns hold no surprise.
  const extraHours = Math.ceil(Math.max(0, bookedHours - pkg.hours));
  const extraHourRate = rates.rental.extraHour[vehicle] ?? 0;
  if (extraHours > 0 && extraHourRate > 0) {
    baseLines.push({
      label: 'Extra hours',
      detail: `${extraHours} hr × ₹${extraHourRate}`,
      amount: extraHours * extraHourRate,
    });
    notes.push('Part hours are billed as full hours.');
  }

  const extraKm = Math.max(0, Math.round(estimatedKm - pkg.includedKm));
  const extraKmRate = rates.rental.extraKm[vehicle] ?? 0;
  if (extraKm > 0 && extraKmRate > 0) {
    baseLines.push({
      label: 'Extra km (estimate)',
      detail: `${extraKm} km × ₹${extraKmRate}`,
      amount: extraKm * extraKmRate,
    });
    notes.push('Extra km is settled on the odometer reading at return.');
  }

  const baseFare = round(baseLines.reduce((s, l) => s + l.amount, 0));
  const discountAmount = round((baseFare * tierCfg.pct) / 100);
  if (tierCfg.pct > 0 && tierCfg.proof) notes.push(tierCfg.proof + '.');

  return {
    pkg,
    bookedHours,
    extraHours,
    includedKm: pkg.includedKm,
    extraKm,
    baseLines: baseLines.map((l) => ({ ...l, amount: round(l.amount) })),
    baseFare,
    discountLabel: tierCfg.label,
    discountPct: tierCfg.pct,
    discountAmount,
    securityDeposit: deposit,
    total: baseFare - discountAmount,
    unavailableReason: null,
    notes,
  };
}

/** Human label for a booking window, e.g. "23 Jul, 9:00 AM → 5:00 PM". */
export function formatWindow(startAt: Date, endAt: Date): string {
  const sameDay = startAt.toDateString() === endAt.toDateString();
  const date = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const time = (d: Date) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return sameDay
    ? `${date(startAt)}, ${time(startAt)} → ${time(endAt)}`
    : `${date(startAt)} ${time(startAt)} → ${date(endAt)} ${time(endAt)}`;
}
