import { describe, expect, it } from "vitest";
import { Stream, newStream } from "../src/models/stream";
import { FuzzyDate } from "../src/models/fuzzyDate";
import { Area } from "../src/models/area";

const AREA = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-07-17T09:00:00.000Z");

describe("Stream invariants", () => {
  it("accepts a plain active stream", () => {
    expect(Stream.safeParse(newStream("Ship v1", AREA, NOW)).success).toBe(true);
  });

  it("accepts an active stream with NO next step — §2.1 flags it, never rejects it", () => {
    const s = newStream("Rotting", AREA, NOW, { nextStep: null });
    expect(Stream.safeParse(s).success).toBe(true);
  });

  it("rejects a parked stream with no wake-up date", () => {
    const s = newStream("Someday", AREA, NOW, { state: "parked", wakeUpDate: null });
    const r = Stream.safeParse(s);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toMatch(/wake-up date/);
    }
  });

  it("accepts a parked stream that has one", () => {
    const s = newStream("Someday", AREA, NOW, { state: "parked", wakeUpDate: "2026-08-01" });
    expect(Stream.safeParse(s).success).toBe(true);
  });

  it("rejects a waiting stream with no waiting-since", () => {
    const s = newStream("Blocked", AREA, NOW, { state: "waiting", waitingSince: null });
    expect(Stream.safeParse(s).success).toBe(false);
  });

  it("rejects an unknown schemaVersion", () => {
    const s = { ...newStream("X", AREA, NOW), schemaVersion: 2 };
    expect(Stream.safeParse(s).success).toBe(false);
  });
});

describe("FuzzyDate", () => {
  it("accepts a real window", () => {
    expect(
      FuzzyDate.safeParse({ label: "end of Q3 2026", earliest: "2026-09-01", latest: "2026-09-30" })
        .success,
    ).toBe(true);
  });

  it("rejects an inverted window", () => {
    const r = FuzzyDate.safeParse({ label: "nonsense", earliest: "2026-09-30", latest: "2026-09-01" });
    expect(r.success).toBe(false);
  });

  it("accepts a single-day window (an exact date is just a narrow one)", () => {
    expect(
      FuzzyDate.safeParse({ label: "14 Sep 2026", earliest: "2026-09-14", latest: "2026-09-14" })
        .success,
    ).toBe(true);
  });

  it("rejects a non-date string", () => {
    expect(
      FuzzyDate.safeParse({ label: "x", earliest: "sometime", latest: "2026-09-01" }).success,
    ).toBe(false);
  });

  it("day strings sort chronologically as plain strings", () => {
    const days = ["2026-10-01", "2026-09-01", "2026-09-30"];
    expect([...days].sort()).toEqual(["2026-09-01", "2026-09-30", "2026-10-01"]);
  });
});

describe("Area", () => {
  it("requires a #rrggbb colour", () => {
    expect(Area.safeParse({ id: AREA, name: "Acme", color: "red" }).success).toBe(false);
    expect(Area.safeParse({ id: AREA, name: "Acme", color: "#ff0000" }).success).toBe(true);
  });
});
