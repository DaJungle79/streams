import { describe, expect, it } from "vitest";
import { addDays, toDay, withState } from "../src/core/transitions";
import { Stream, newStream } from "../src/models/stream";

const AREA = "11111111-1111-4111-8111-111111111111";
const NOW = new Date(2026, 6, 17, 9, 0, 0); // local 2026-07-17

const base = () => newStream("S", AREA, NOW);

describe("toDay / addDays", () => {
  it("uses the local calendar day, not UTC", () => {
    // 23:30 local on the 17th is already the 18th in UTC. The user's day wins.
    expect(toDay(new Date(2026, 6, 17, 23, 30))).toBe("2026-07-17");
  });

  it("adds days across a month boundary", () => {
    expect(addDays("2026-07-28", 7)).toBe("2026-08-04");
  });

  it("adds days across a year boundary", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("withState", () => {
  it("parking supplies a wake-up date, so the result actually saves", () => {
    const parked = withState(base(), "parked", NOW);
    expect(parked.wakeUpDate).toBe("2026-07-24");
    expect(Stream.safeParse(parked).success).toBe(true);
  });

  it("re-parking keeps a wake-up date the user chose", () => {
    const s = { ...base(), state: "parked" as const, wakeUpDate: "2026-09-01" };
    expect(withState(s, "parked", NOW).wakeUpDate).toBe("2026-09-01");
  });

  it("waiting supplies waiting-since, so the result actually saves", () => {
    const w = withState(base(), "waiting", NOW);
    expect(w.waitingSince).toBe("2026-07-17");
    expect(Stream.safeParse(w).success).toBe(true);
  });

  it("waiting preserves an existing waiting-since — the clock must not reset", () => {
    // §2.4 fires on how long it has been waiting. Resetting this on an
    // unrelated edit would silently forgive an overdue wait.
    const s = { ...base(), state: "waiting" as const, waitingSince: "2026-07-01" };
    expect(withState(s, "waiting", NOW).waitingSince).toBe("2026-07-01");
  });

  it("leaving parked clears the wake-up date", () => {
    const parked = withState(base(), "parked", NOW);
    expect(withState(parked, "active", NOW).wakeUpDate).toBeNull();
  });

  it("leaving waiting clears waiting-since", () => {
    const waiting = withState(base(), "waiting", NOW);
    expect(withState(waiting, "active", NOW).waitingSince).toBeNull();
  });

  it("every transition from every state produces a saveable stream", () => {
    const states = ["active", "waiting", "parked", "done"] as const;
    for (const from of states) {
      for (const to of states) {
        const start = withState(base(), from, NOW);
        const end = withState(start, to, NOW);
        expect(Stream.safeParse(end).success, `${from} -> ${to}`).toBe(true);
      }
    }
  });
});
