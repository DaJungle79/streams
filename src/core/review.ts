import { Stream } from "../models/stream";
import { AttentionOptions } from "./attentionEngine";
import { daysSince, toDay } from "./days";

/**
 * Weekly review (SPEC §3.4): a guided pass over every live stream, one at a
 * time, asking *still relevant? → is the next step right? → is the owner right?*
 */

/** SPEC §3.4: "when >25% of active streams are overdue for check-in". */
export const OVERDUE_FRACTION_TRIGGER = 0.25;
/** SPEC §3.4: "...or weekly — whichever comes first." */
export const REVIEW_INTERVAL_DAYS = 7;

/**
 * Streams still awaiting review in this pass.
 *
 * A stream is done-for-this-pass once `lastTouched >= startedAt`. That falls out
 * of data we already keep, so there's no reviewed-id list to persist, drift, or
 * merge across two Macs — and it makes the pass resumable after a restart for
 * free. It also means an edit made outside the review counts, which is §3.2's
 * rule (any touch satisfies a check-in) rather than an accident.
 */
export function reviewQueue(streams: Stream[], startedAt: string): Stream[] {
  return streams
    .filter((s) => s.state !== "done")
    .filter((s) => s.lastTouched < startedAt)
    // Stable, and worth doing in a useful order: high priority first, then the
    // stalest, so a review abandoned halfway still covered what mattered most.
    .sort(
      (a, b) =>
        (a.priority === b.priority ? 0 : a.priority === "high" ? -1 : 1) ||
        a.lastTouched.localeCompare(b.lastTouched) ||
        a.title.localeCompare(b.title),
    );
}

export type ReviewProgress = { reviewed: number; total: number };

/** "7 of 23" (SPEC §3.4). Total is the pass's size, not what's left. */
export function reviewProgress(streams: Stream[], startedAt: string): ReviewProgress {
  const live = streams.filter((s) => s.state !== "done");
  const remaining = reviewQueue(streams, startedAt).length;
  return { reviewed: live.length - remaining, total: live.length };
}

export type ReviewSuggestion = { suggest: boolean; reason: string };

/**
 * Whether to nudge the user into a review (SPEC §3.4).
 *
 * Two triggers, whichever fires first: a quarter of active streams overdue for
 * check-in, or a week since the last pass.
 */
export function shouldSuggestReview(
  streams: Stream[],
  now: Date,
  lastReviewAt: string | null,
  opts: AttentionOptions,
): ReviewSuggestion {
  const today = toDay(now);

  const active = streams.filter((s) => s.state === "active");
  const overdue = active.filter((s) => {
    const cadence = s.checkInCadenceDays ?? opts.defaultCheckInCadenceDays;
    return cadence !== null && daysSince(s.lastTouched, today) > cadence;
  });

  // Guard the empty case: 0/0 is not "100% overdue", and suggesting a review of
  // nothing is the kind of noise that gets the suggestion permanently dismissed.
  if (active.length > 0 && overdue.length / active.length > OVERDUE_FRACTION_TRIGGER) {
    return {
      suggest: true,
      reason: `${overdue.length} of ${active.length} active streams are overdue for check-in`,
    };
  }

  if (lastReviewAt === null) {
    // Never reviewed. Only worth suggesting once there's something to review.
    return streams.some((s) => s.state !== "done")
      ? { suggest: true, reason: "you haven't run a review yet" }
      : { suggest: false, reason: "" };
  }

  const days = daysSince(lastReviewAt, today);
  if (days >= REVIEW_INTERVAL_DAYS) {
    return { suggest: true, reason: `last review was ${days} days ago` };
  }

  return { suggest: false, reason: "" };
}
