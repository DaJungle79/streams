import { Stream, StreamState } from "../models/stream";
import { addDays, toDay } from "./days";

export { addDays, toDay };

/** SPEC §4.2: quick-captured streams park for a week by default. */
export const DEFAULT_WAKE_UP_DAYS = 7;

/**
 * Move a stream to `next`, supplying the fields that state demands.
 *
 * The Stream schema refuses a parked stream with no wake-up date and a waiting
 * stream with no waiting-since -- so a naive `{...s, state}` would produce a
 * value that fails to save. This is the only sanctioned way to change state:
 * it makes those invariants the caller's default rather than the caller's
 * problem.
 */
export function withState(stream: Stream, next: StreamState, now: Date): Stream {
  const today = toDay(now);
  const base = { ...stream, state: next };

  switch (next) {
    case "parked":
      return {
        ...base,
        // Preserve an existing wake-up date -- re-parking shouldn't silently
        // push out a date the user deliberately chose.
        wakeUpDate: stream.wakeUpDate ?? addDays(today, DEFAULT_WAKE_UP_DAYS),
        waitingSince: null,
      };
    case "waiting":
      return {
        ...base,
        waitingSince: stream.waitingSince ?? today,
        wakeUpDate: null,
      };
    case "active":
    case "done":
      return { ...base, waitingSince: null, wakeUpDate: null };
  }
}
