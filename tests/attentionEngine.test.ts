import { describe, expect, it } from "vitest";
import {
  AttentionReason,
  DEFAULT_OPTIONS,
  attentionCount,
  attentionGroups,
  attentionItems,
} from "../src/core/attentionEngine";
import { addDays, toDay } from "../src/core/days";
import { Stream, newStream } from "../src/models/stream";

const AREA = "11111111-1111-4111-8111-111111111111";
const NOW = new Date(2026, 6, 17, 9, 0, 0);
const TODAY = toDay(NOW); // 2026-07-17

/** `daysAgo(3)` -> an instant 3 days before NOW. */
const instantDaysAgo = (n: number) => new Date(2026, 6, 17 - n, 9, 0, 0).toISOString();

function stream(overrides: Partial<Stream> = {}): Stream {
  return { ...newStream("S", AREA, NOW), ...overrides };
}

const reasons = (streams: Stream[]) => attentionItems(streams, NOW).map((i) => i.reason);
const only = (s: Stream): AttentionReason | undefined => attentionItems([s], NOW)[0]?.reason;

describe("§2.1 — no next step", () => {
  it("an active stream with no next step is surfaced", () => {
    expect(only(stream({ nextStep: null }))).toBe("no-next-step");
  });

  it("an active stream with a next step is not", () => {
    const s = stream({ nextStep: { text: "call Bob", owner: { kind: "me" }, setAt: TODAY } });
    expect(attentionItems([s], NOW)).toHaveLength(0);
  });

  it("only ACTIVE streams — a waiting stream's step is someone else's to have", () => {
    const s = stream({ state: "waiting", waitingSince: TODAY, nextStep: null });
    expect(only(s)).toBeUndefined();
  });
});

describe("§2.2 — check-in overdue", () => {
  const withCadence = (days: number, touchedDaysAgo: number) =>
    stream({
      checkInCadenceDays: days,
      lastTouched: instantDaysAgo(touchedDaysAgo),
      nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY },
    });

  it("fires once the cadence has elapsed", () => {
    expect(only(withCadence(7, 8))).toBe("check-in-overdue");
  });

  it("does not fire exactly ON the cadence day — 7 days after touch is not yet late", () => {
    expect(only(withCadence(7, 7))).toBeUndefined();
  });

  it("does not fire before", () => {
    expect(only(withCadence(7, 3))).toBeUndefined();
  });

  it("no cadence means no check-in trigger, however stale — cadence is opt-in per stream", () => {
    const noCadence = stream({
      checkInCadenceDays: null,
      lastTouched: instantDaysAgo(400),
      nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY },
    });
    expect(only(noCadence)).toBeUndefined();
  });

  it("reports how overdue it is", () => {
    expect(attentionItems([withCadence(7, 10)], NOW)[0].detail).toBe("check-in 3 days overdue");
  });
});

describe("§2.3 — deadline window / milestone", () => {
  const withDeadline = (earliest: string, latest: string) =>
    stream({
      nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY },
      targetDeadline: { label: "end of Q3 2026", earliest, latest },
    });

  it("fires when the window opens", () => {
    expect(only(withDeadline(TODAY, addDays(TODAY, 14)))).toBe("deadline-window");
  });

  it("does not fire before the window opens", () => {
    expect(only(withDeadline(addDays(TODAY, 1), addDays(TODAY, 30)))).toBeUndefined();
  });

  it("shows the user's label, never the raw earliest date", () => {
    const d = attentionItems([withDeadline(TODAY, addDays(TODAY, 14))], NOW)[0].detail;
    expect(d).toContain("end of Q3 2026");
    expect(d).not.toContain("2026-07-17");
  });

  it("a milestone within the horizon fires", () => {
    const s = stream({
      nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY },
      nextMilestone: { text: "board pack out", date: addDays(TODAY, 4) },
    });
    expect(only(s)).toBe("deadline-window");
    expect(attentionItems([s], NOW)[0].detail).toBe("milestone in 4 days — board pack out");
  });

  it("a milestone beyond the horizon does not", () => {
    const s = stream({
      nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY },
      nextMilestone: { text: "later", date: addDays(TODAY, 8) },
    });
    expect(only(s)).toBeUndefined();
  });

  it("an overdue milestone still fires — passing the date must not silence it", () => {
    const s = stream({
      nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY },
      nextMilestone: { text: "slipped", date: addDays(TODAY, -3) },
    });
    expect(only(s)).toBe("deadline-window");
    expect(attentionItems([s], NOW)[0].detail).toBe("milestone 3 days overdue — slipped");
  });

  it("an overdue milestone outranks a just-opened one", () => {
    const late = stream({ title: "late", nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY }, nextMilestone: { text: "m", date: addDays(TODAY, -5) } });
    const soon = stream({ title: "soon", nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY }, nextMilestone: { text: "m", date: addDays(TODAY, 5) } });
    expect(attentionItems([soon, late], NOW).map((i) => i.stream.title)).toEqual(["late", "soon"]);
  });
});

describe("§2.4 — waiting too long", () => {
  const waiting = (sinceDaysAgo: number, name = "Bob") =>
    stream({
      state: "waiting",
      waitingSince: addDays(TODAY, -sinceDaysAgo),
      nextStep: { text: "review", owner: { kind: "person", name }, setAt: TODAY },
    });

  it("fires past the threshold", () => expect(only(waiting(8))).toBe("waiting-too-long"));
  it("does not fire at exactly the threshold", () => expect(only(waiting(7))).toBeUndefined());
  it("does not fire under it", () => expect(only(waiting(2))).toBeUndefined());

  it("names the person — the action is 'go nudge Bob'", () => {
    expect(attentionItems([waiting(9)], NOW)[0].detail).toBe("waiting on Bob for 9 days");
  });

  it("threshold is configurable (SPEC §2.4)", () => {
    const s = waiting(5);
    expect(attentionItems([s], NOW, { ...DEFAULT_OPTIONS, waitingThresholdDays: 3 })).toHaveLength(1);
    expect(attentionItems([s], NOW, { ...DEFAULT_OPTIONS, waitingThresholdDays: 14 })).toHaveLength(0);
  });
});

describe("§2.5 — waking up", () => {
  it("fires on the wake-up day", () => {
    expect(only(stream({ state: "parked", wakeUpDate: TODAY }))).toBe("waking-up");
  });

  it("still fires if the day has passed — a missed wake-up must not vanish", () => {
    const s = stream({ state: "parked", wakeUpDate: addDays(TODAY, -3) });
    expect(only(s)).toBe("waking-up");
    expect(attentionItems([s], NOW)[0].detail).toBe("woke up 3 days ago");
  });

  it("stays quiet before the day", () => {
    expect(only(stream({ state: "parked", wakeUpDate: addDays(TODAY, 3) }))).toBeUndefined();
  });

  it("a parked stream is silent on every OTHER trigger — dormancy is deliberate", () => {
    // Deadline open, cadence blown, no next step: still silent until it wakes.
    const s = stream({
      state: "parked",
      wakeUpDate: addDays(TODAY, 30),
      nextStep: null,
      checkInCadenceDays: 1,
      lastTouched: instantDaysAgo(90),
      targetDeadline: { label: "Q3", earliest: addDays(TODAY, -10), latest: addDays(TODAY, 10) },
    });
    expect(attentionItems([s], NOW)).toHaveLength(0);
  });
});

describe("done streams", () => {
  it("are never surfaced, whatever they trip", () => {
    const s = stream({
      state: "done",
      nextStep: null,
      checkInCadenceDays: 1,
      lastTouched: instantDaysAgo(90),
      targetDeadline: { label: "Q3", earliest: addDays(TODAY, -10), latest: TODAY },
    });
    expect(attentionItems([s], NOW)).toHaveLength(0);
  });
});

describe("precedence — one stream, one reason", () => {
  it("a stream tripping several appears exactly once", () => {
    const s = stream({
      nextStep: null,
      checkInCadenceDays: 1,
      lastTouched: instantDaysAgo(30),
      targetDeadline: { label: "Q3", earliest: addDays(TODAY, -5), latest: addDays(TODAY, 5) },
    });
    expect(attentionItems([s], NOW)).toHaveLength(1);
  });

  it("no-next-step beats deadline and check-in", () => {
    const s = stream({
      nextStep: null,
      checkInCadenceDays: 1,
      lastTouched: instantDaysAgo(30),
      targetDeadline: { label: "Q3", earliest: addDays(TODAY, -5), latest: addDays(TODAY, 5) },
    });
    expect(only(s)).toBe("no-next-step");
  });

  it("deadline beats check-in — a concrete date outranks 'you haven't looked'", () => {
    const s = stream({
      nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY },
      checkInCadenceDays: 1,
      lastTouched: instantDaysAgo(30),
      targetDeadline: { label: "Q3", earliest: addDays(TODAY, -5), latest: addDays(TODAY, 5) },
    });
    expect(only(s)).toBe("deadline-window");
  });

  it("waiting-too-long beats check-in", () => {
    const s = stream({
      state: "waiting",
      waitingSince: addDays(TODAY, -20),
      nextStep: { text: "x", owner: { kind: "person", name: "Bob" }, setAt: TODAY },
      checkInCadenceDays: 1,
      lastTouched: instantDaysAgo(30),
    });
    expect(only(s)).toBe("waiting-too-long");
  });

  it("waking-up wins over everything", () => {
    const s = stream({
      state: "parked",
      wakeUpDate: TODAY,
      nextStep: null,
      checkInCadenceDays: 1,
      lastTouched: instantDaysAgo(30),
    });
    expect(only(s)).toBe("waking-up");
  });

  it("the tray count counts STREAMS, not reasons (SPEC §4.1)", () => {
    const messy = stream({
      nextStep: null,
      checkInCadenceDays: 1,
      lastTouched: instantDaysAgo(30),
      targetDeadline: { label: "Q3", earliest: addDays(TODAY, -5), latest: addDays(TODAY, 5) },
    });
    expect(attentionCount([messy], NOW)).toBe(1);
  });
});

describe("ordering", () => {
  it("groups follow SPEC §2's numbering", () => {
    const streams = [
      stream({ state: "parked", wakeUpDate: TODAY }),
      stream({ state: "waiting", waitingSince: addDays(TODAY, -30), nextStep: { text: "x", owner: { kind: "person", name: "B" }, setAt: TODAY } }),
      stream({ nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY }, targetDeadline: { label: "Q3", earliest: TODAY, latest: TODAY } }),
      stream({ nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY }, checkInCadenceDays: 1, lastTouched: instantDaysAgo(30) }),
      stream({ nextStep: null }),
    ];
    expect(attentionGroups(streams, NOW).map((g) => g.reason)).toEqual([
      "no-next-step",
      "check-in-overdue",
      "deadline-window",
      "waiting-too-long",
      "waking-up",
    ]);
  });

  it("high priority pins to the top of its group", () => {
    const normal = stream({ title: "normal", nextStep: null, lastTouched: instantDaysAgo(50) });
    const high = stream({ title: "high", nextStep: null, priority: "high", lastTouched: instantDaysAgo(1) });
    // `high` is far less overdue, and still leads.
    expect(attentionItems([normal, high], NOW).map((i) => i.stream.title)).toEqual(["high", "normal"]);
  });

  it("empty groups are omitted, so the view never shows a hollow header", () => {
    expect(attentionGroups([stream({ nextStep: null })], NOW).map((g) => g.reason)).toEqual([
      "no-next-step",
    ]);
  });

  it("nothing needing attention yields nothing — the §2 empty state is real", () => {
    const calm = stream({ nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY } });
    expect(attentionGroups([calm], NOW)).toEqual([]);
    expect(attentionCount([calm], NOW)).toBe(0);
  });
});

describe("SPEC §8 — no stream can silently rot", () => {
  it("an active stream with no next step and no cadence is still caught", () => {
    expect(only(stream({ nextStep: null, checkInCadenceDays: null }))).toBe("no-next-step");
  });

  it("a long-neglected stream with a next step is caught by cadence", () => {
    const s = stream({
      nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY },
      checkInCadenceDays: 30,
      lastTouched: instantDaysAgo(365),
    });
    expect(only(s)).toBe("check-in-overdue");
  });

  it("THE GAP: an active stream with a next step, no cadence and no dates is never surfaced", () => {
    // Not a bug in the engine -- a real hole in §8's guarantee, reachable
    // through the M1 UI today. Documented in PLAN so it is chosen, not missed.
    const s = stream({
      nextStep: { text: "x", owner: { kind: "me" }, setAt: TODAY },
      checkInCadenceDays: null,
      targetDeadline: null,
      nextMilestone: null,
      lastTouched: instantDaysAgo(9999),
    });
    expect(attentionItems([s], NOW)).toHaveLength(0);
  });
});
