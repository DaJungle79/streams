import { IsoDay } from "../models/common";

/**
 * Calendar-day arithmetic on `YYYY-MM-DD` strings.
 *
 * Days, not instants, and local, not UTC. A stream parked late on the 17th in
 * Sofia must wake on the user's 17th+7, not on a UTC boundary that already
 * rolled over. Every date the user picks or sees goes through here.
 */

export function toDay(d: Date): IsoDay {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parts(day: IsoDay): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}

export function addDays(day: IsoDay, n: number): IsoDay {
  const [y, m, d] = parts(day);
  // Noon, so a DST shift can never roll the date backwards.
  const dt = new Date(y, m - 1, d, 12);
  dt.setDate(dt.getDate() + n);
  return toDay(dt);
}

/** `b - a`, in whole days. Positive when `b` is later. */
export function daysBetween(a: IsoDay, b: IsoDay): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}

/** Whole days elapsed from an instant to a day, floored at 0. */
export function daysSince(instant: string, today: IsoDay): number {
  return Math.max(0, daysBetween(toDay(new Date(instant)), today));
}
