import { z } from "zod";

/**
 * Calendar day, no time, no zone: `2026-09-01`.
 *
 * Deadlines, milestones and wake-up dates are days, not instants -- a stream
 * waking up "on the 14th" means the user's 14th, not a UTC one. Storing them as
 * plain days keeps them stable across timezones, and ISO day strings compare
 * lexicographically in the same order they compare chronologically, so ranges
 * and sorts work on the raw strings.
 */
export const IsoDay = z.iso.date();
export type IsoDay = z.infer<typeof IsoDay>;

/** An instant: `lastTouched`, log entry timestamps. */
export const IsoInstant = z.iso.datetime();
export type IsoInstant = z.infer<typeof IsoInstant>;

export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;
