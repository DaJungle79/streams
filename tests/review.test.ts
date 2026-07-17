import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS } from "../src/core/attentionEngine";
import { addDays, toDay } from "../src/core/days";
import {
  REVIEW_INTERVAL_DAYS,
  reviewProgress,
  reviewQueue,
  shouldSuggestReview,
} from "../src/core/review";
import { Stream, newStream } from "../src/models/stream";

const AREA = "11111111-1111-4111-8111-111111111111";
const NOW = new Date(2026, 6, 17, 9, 0, 0);
const TODAY = toDay(NOW);
const at = (daysAgo: number) => new Date(2026, 6, 17 - daysAgo, 9, 0, 0).toISOString();

const s = (o: Partial<Stream> = {}): Stream => ({ ...newStream("S", AREA, NOW), ...o });

/** A review that began an hour ago. */
const STARTED = new Date(2026, 6, 17, 8, 0, 0).toISOString();

describe("reviewQueue", () => {
  it("includes every live stream not yet touched in this pass", () => {
    const q = reviewQueue([s({ title: "a", lastTouched: at(5) }), s({ title: "b", lastTouched: at(3) })], STARTED);
    expect(q).toHaveLength(2);
  });

  it("excludes done streams — the archive isn't reviewed", () => {
    expect(reviewQueue([s({ state: "done", lastTouched: at(5) })], STARTED)).toHaveLength(0);
  });

  it("includes parked and waiting — §3.4 asks 'still relevant?' of everything live", () => {
    const q = reviewQueue(
      [
        s({ state: "parked", wakeUpDate: addDays(TODAY, 30), lastTouched: at(5) }),
        s({ state: "waiting", waitingSince: TODAY, lastTouched: at(5) }),
      ],
      STARTED,
    );
    expect(q).toHaveLength(2);
  });

  it("drops a stream once it's been touched — that's what makes it resumable", () => {
    const reviewed = s({ lastTouched: new Date(2026, 6, 17, 8, 30).toISOString() });
    expect(reviewQueue([reviewed], STARTED)).toHaveLength(0);
  });

  it("an edit made OUTSIDE the review also counts — §3.2: any touch is a check-in", () => {
    const editedElsewhere = s({ lastTouched: new Date(2026, 6, 17, 8, 45).toISOString() });
    expect(reviewQueue([editedElsewhere], STARTED)).toHaveLength(0);
  });

  it("high priority first, then stalest — an abandoned review still covered what mattered", () => {
    const q = reviewQueue(
      [
        s({ title: "fresh-normal", lastTouched: at(1) }),
        s({ title: "stale-normal", lastTouched: at(40) }),
        s({ title: "fresh-high", priority: "high", lastTouched: at(1) }),
      ],
      STARTED,
    );
    expect(q.map((x) => x.title)).toEqual(["fresh-high", "stale-normal", "fresh-normal"]);
  });

  it("is stable for equal streams", () => {
    const a = s({ title: "a", lastTouched: at(5) });
    const b = s({ title: "b", lastTouched: at(5) });
    expect(reviewQueue([b, a], STARTED).map((x) => x.title)).toEqual(["a", "b"]);
  });
});

describe("reviewProgress", () => {
  it('reads "n of total" over the whole pass', () => {
    const streams = [
      s({ lastTouched: at(5) }),
      s({ lastTouched: at(5) }),
      s({ lastTouched: new Date(2026, 6, 17, 8, 30).toISOString() }),
    ];
    expect(reviewProgress(streams, STARTED)).toEqual({ reviewed: 1, total: 3 });
  });

  it("counts done streams in neither half", () => {
    expect(reviewProgress([s({ state: "done", lastTouched: at(5) })], STARTED)).toEqual({
      reviewed: 0,
      total: 0,
    });
  });

  it("a finished pass reads total of total", () => {
    const done = s({ lastTouched: new Date(2026, 6, 17, 8, 30).toISOString() });
    expect(reviewProgress([done], STARTED)).toEqual({ reviewed: 1, total: 1 });
  });
});

describe("shouldSuggestReview", () => {
  const fresh = (n: number) => Array.from({ length: n }, () => s({ lastTouched: at(1), checkInCadenceDays: 30 }));
  const stale = (n: number) => Array.from({ length: n }, () => s({ lastTouched: at(90), checkInCadenceDays: 30 }));
  const yesterday = at(1);

  it("fires when more than 25% of active streams are overdue", () => {
    // 2 of 6 = 33%.
    const r = shouldSuggestReview([...stale(2), ...fresh(4)], NOW, yesterday, DEFAULT_OPTIONS);
    expect(r.suggest).toBe(true);
    expect(r.reason).toBe("2 of 6 active streams are overdue for check-in");
  });

  it("does NOT fire at exactly 25% — the spec says 'more than'", () => {
    // 1 of 4 = exactly 25%.
    expect(shouldSuggestReview([...stale(1), ...fresh(3)], NOW, yesterday, DEFAULT_OPTIONS).suggest).toBe(false);
  });

  it("fires weekly regardless of overdue count", () => {
    const r = shouldSuggestReview(fresh(4), NOW, at(REVIEW_INTERVAL_DAYS), DEFAULT_OPTIONS);
    expect(r.suggest).toBe(true);
    expect(r.reason).toBe("last review was 7 days ago");
  });

  it("stays quiet inside the week when nothing is overdue", () => {
    expect(shouldSuggestReview(fresh(4), NOW, at(3), DEFAULT_OPTIONS).suggest).toBe(false);
  });

  it("the overdue trigger beats the weekly one — whichever comes first", () => {
    const r = shouldSuggestReview([...stale(3), ...fresh(1)], NOW, at(1), DEFAULT_OPTIONS);
    expect(r.suggest).toBe(true);
    expect(r.reason).toContain("overdue");
  });

  it("suggests a first review when streams exist but none has run", () => {
    const r = shouldSuggestReview([s({ lastTouched: at(1), checkInCadenceDays: 30 })], NOW, null, DEFAULT_OPTIONS);
    expect(r.suggest).toBe(true);
    expect(r.reason).toBe("you haven't run a review yet");
  });

  it("never suggests reviewing nothing — an empty app must not nag", () => {
    expect(shouldSuggestReview([], NOW, null, DEFAULT_OPTIONS).suggest).toBe(false);
    expect(shouldSuggestReview([s({ state: "done" })], NOW, null, DEFAULT_OPTIONS).suggest).toBe(false);
  });

  it("0 active streams is not 100% overdue — no divide-by-zero nag", () => {
    const parked = s({ state: "parked", wakeUpDate: addDays(TODAY, 5), lastTouched: at(90) });
    expect(shouldSuggestReview([parked], NOW, yesterday, DEFAULT_OPTIONS).suggest).toBe(false);
  });

  it("respects the inherited default cadence when a stream sets none", () => {
    const noCadence = Array.from({ length: 4 }, () => s({ lastTouched: at(90), checkInCadenceDays: null }));
    expect(shouldSuggestReview(noCadence, NOW, yesterday, DEFAULT_OPTIONS).suggest).toBe(true);
    // With the global net off, nothing is overdue, so only the weekly rule remains.
    expect(
      shouldSuggestReview(noCadence, NOW, yesterday, { ...DEFAULT_OPTIONS, defaultCheckInCadenceDays: null }).suggest,
    ).toBe(false);
  });
});
