import { describe, expect, it } from "vitest";
import { Snapshot, buildSnapshot, fingerprint } from "../src/services/backup";
import { Area } from "../src/models/area";
import { DEFAULT_SETTINGS } from "../src/models/settings";
import { Stream, newStream } from "../src/models/stream";

const AREA_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date(2026, 6, 17, 12, 0, 0);
const areas: Area[] = [{ id: AREA_ID, name: "Acme", color: "#6b7fd7" }];
const s = (id: string, o: Partial<Stream> = {}): Stream => ({
  ...newStream("S", AREA_ID, NOW),
  id,
  ...o,
});

const ID_A = "22222222-2222-4222-8222-222222222222";
const ID_B = "33333333-3333-4333-8333-333333333333";

describe("buildSnapshot", () => {
  it("captures the whole store", () => {
    const snap = buildSnapshot([s(ID_A)], areas, DEFAULT_SETTINGS, NOW);
    expect(snap.snapshotVersion).toBe(1);
    expect(snap.takenAt).toBe(NOW.toISOString());
    expect(snap.streams).toHaveLength(1);
    expect(snap.areas).toHaveLength(1);
  });

  it("is schema-valid, so a restore can trust it", () => {
    const snap = buildSnapshot([s(ID_A), s(ID_B)], areas, DEFAULT_SETTINGS, NOW);
    expect(Snapshot.safeParse(snap).success).toBe(true);
  });

  it("sorts, so load order can't change the bytes", () => {
    const one = buildSnapshot([s(ID_A), s(ID_B)], areas, DEFAULT_SETTINGS, NOW);
    const two = buildSnapshot([s(ID_B), s(ID_A)], areas, DEFAULT_SETTINGS, NOW);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  it("rejects a snapshot with an invalid stream — a corrupt parachute is worse than none", () => {
    const bad = {
      ...buildSnapshot([s(ID_A)], areas, DEFAULT_SETTINGS, NOW),
      streams: [{ ...s(ID_A), state: "parked", wakeUpDate: null }],
    };
    expect(Snapshot.safeParse(bad).success).toBe(false);
  });
});

describe("fingerprint — what counts as 'the store changed'", () => {
  const fp = (streams: Stream[], as = areas, set = DEFAULT_SETTINGS) =>
    fingerprint(buildSnapshot(streams, as, set, NOW));

  it("is stable across identical stores taken at different times", () => {
    const a = fingerprint(buildSnapshot([s(ID_A)], areas, DEFAULT_SETTINGS, NOW));
    const b = fingerprint(buildSnapshot([s(ID_A)], areas, DEFAULT_SETTINGS, new Date(2027, 0, 1)));
    expect(a).toBe(b);
  });

  it("is stable regardless of stream order", () => {
    expect(fp([s(ID_A), s(ID_B)])).toBe(fp([s(ID_B), s(ID_A)]));
  });

  it("changes when a stream changes", () => {
    expect(fp([s(ID_A)])).not.toBe(fp([s(ID_A, { title: "renamed" })]));
  });

  it("changes when a stream is added or removed", () => {
    expect(fp([s(ID_A)])).not.toBe(fp([s(ID_A), s(ID_B)]));
    expect(fp([s(ID_A)])).not.toBe(fp([]));
  });

  it("changes when an area changes", () => {
    expect(fp([s(ID_A)])).not.toBe(fp([s(ID_A)], [{ ...areas[0], name: "Renamed" }]));
  });

  it("changes when a real setting changes", () => {
    expect(fp([s(ID_A)])).not.toBe(
      fp([s(ID_A)], areas, { ...DEFAULT_SETTINGS, waitingThresholdDays: 14 }),
    );
  });

  it("does NOT change when only review bookkeeping moves", () => {
    // Opening a review must not snapshot otherwise-identical data.
    expect(fp([s(ID_A)])).toBe(
      fp([s(ID_A)], areas, { ...DEFAULT_SETTINGS, activeReviewStartedAt: NOW.toISOString() }),
    );
    expect(fp([s(ID_A)])).toBe(
      fp([s(ID_A)], areas, { ...DEFAULT_SETTINGS, lastReviewAt: NOW.toISOString() }),
    );
  });

  it("a log entry counts as a change — the log is the stream's memory", () => {
    const withLog = s(ID_A, {
      log: [{ id: ID_B, at: NOW.toISOString(), kind: "manual", text: "note" }],
    });
    expect(fp([s(ID_A)])).not.toBe(fp([withLog]));
  });
});

describe("round trip", () => {
  it("a snapshot parses back to exactly what went in", () => {
    const streams = [s(ID_A, { title: "да поръчам кашпи" }), s(ID_B, { state: "parked", wakeUpDate: "2026-08-01" })];
    const snap = buildSnapshot(streams, areas, DEFAULT_SETTINGS, NOW);
    const reparsed = Snapshot.parse(JSON.parse(JSON.stringify(snap)));
    expect(reparsed).toEqual(snap);
    // Non-ASCII survives the JSON layer.
    expect(reparsed.streams.find((x) => x.id === ID_A)!.title).toBe("да поръчам кашпи");
  });
});
