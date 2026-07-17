import { describe, expect, it } from "vitest";
import { mergeLogs, mergeStreams } from "../src/core/merge";
import { LogEntry, newLogEntry } from "../src/models/logEntry";
import { Stream, newStream } from "../src/models/stream";

const AREA = "11111111-1111-4111-8111-111111111111";
const NOW = new Date(2026, 6, 17, 12, 0, 0);
const ID = "22222222-2222-4222-8222-222222222222";

const at = (h: number) => new Date(2026, 6, 17, h, 0, 0).toISOString();

const entry = (id: string, hour: number, text: string): LogEntry => ({
  id,
  at: at(hour),
  kind: "manual",
  text,
});

const base = (o: Partial<Stream> = {}): Stream => ({
  ...newStream("S", AREA, NOW),
  id: ID,
  ...o,
});

describe("mergeLogs — the promise that no entry is ever lost", () => {
  it("unions disjoint entries from both sides", () => {
    const a = [entry("1", 9, "mac A")];
    const b = [entry("2", 10, "mac B")];
    expect(mergeLogs(a, b).map((e) => e.id).sort()).toEqual(["1", "2"]);
  });

  it("de-duplicates entries both sides already had", () => {
    const shared = entry("1", 9, "shared");
    expect(mergeLogs([shared], [shared])).toHaveLength(1);
  });

  it("newest first", () => {
    const merged = mergeLogs([entry("1", 9, "old")], [entry("2", 11, "new")]);
    expect(merged.map((e) => e.id)).toEqual(["2", "1"]);
  });

  it("is deterministic for same-instant entries — two Macs must converge", () => {
    const a = entry("aaa", 9, "a");
    const b = entry("bbb", 9, "b");
    expect(mergeLogs([a], [b]).map((e) => e.id)).toEqual(mergeLogs([b], [a]).map((e) => e.id));
  });

  it("is commutative in content", () => {
    const a = [entry("1", 9, "a"), entry("3", 11, "c")];
    const b = [entry("2", 10, "b")];
    const ab = mergeLogs(a, b).map((e) => e.id);
    const ba = mergeLogs(b, a).map((e) => e.id);
    expect(ab).toEqual(ba);
  });

  it("survives a big offline divergence with nothing lost", () => {
    const a = Array.from({ length: 40 }, (_, i) => entry(`a${i}`, 9, `a${i}`));
    const b = Array.from({ length: 40 }, (_, i) => entry(`b${i}`, 10, `b${i}`));
    expect(mergeLogs(a, b)).toHaveLength(80);
  });

  it("empty sides are handled", () => {
    expect(mergeLogs([], [])).toEqual([]);
    expect(mergeLogs([entry("1", 9, "x")], [])).toHaveLength(1);
  });
});

describe("mergeStreams — scalars are last-write-wins", () => {
  it("the newer side's fields win", () => {
    const older = base({ title: "old title", lastTouched: at(9) });
    const newer = base({ title: "new title", lastTouched: at(11) });
    expect(mergeStreams(older, newer, NOW).stream.title).toBe("new title");
  });

  it("order of arguments doesn't matter — both Macs converge on the same state", () => {
    const older = base({ title: "old", outcome: "o1", lastTouched: at(9) });
    const newer = base({ title: "new", outcome: "o2", lastTouched: at(11) });
    const ab = mergeStreams(older, newer, NOW).stream;
    const ba = mergeStreams(newer, older, NOW).stream;
    expect(ab.title).toBe(ba.title);
    expect(ab.outcome).toBe(ba.outcome);
    expect(ab.lastTouched).toBe(ba.lastTouched);
  });

  it("keeps the newer lastTouched", () => {
    const m = mergeStreams(base({ lastTouched: at(9) }), base({ lastTouched: at(11) }), NOW);
    expect(m.stream.lastTouched).toBe(at(11));
  });

  it("the LOSING side's log entries still survive — that's the whole point", () => {
    const older = base({ title: "old", lastTouched: at(9), log: [entry("1", 9, "written on A")] });
    const newer = base({ title: "new", lastTouched: at(11), log: [entry("2", 11, "written on B")] });
    const { stream } = mergeStreams(older, newer, NOW);
    expect(stream.title).toBe("new");
    expect(stream.log.map((e) => e.text)).toContain("written on A");
    expect(stream.log.map((e) => e.text)).toContain("written on B");
  });

  it("logs the merge — SPEC §6 requires it be loud, never silent", () => {
    const { stream } = mergeStreams(
      base({ title: "old", lastTouched: at(9) }),
      base({ title: "new", lastTouched: at(11) }),
      NOW,
    );
    expect(stream.log[0].kind).toBe("conflict-merged");
  });

  it("does NOT log when the sides only differ by log entries — that's a sync, not a conflict", () => {
    const a = base({ lastTouched: at(9), log: [entry("1", 9, "a")] });
    const b = base({ lastTouched: at(11), log: [entry("2", 10, "b")] });
    const { stream, loserLostFields } = mergeStreams(a, b, NOW);
    expect(loserLostFields).toBe(false);
    expect(stream.log.some((e) => e.kind === "conflict-merged")).toBe(false);
    expect(stream.log).toHaveLength(2);
  });

  it("an identical duplicate merges to itself with no noise", () => {
    const s = base({ lastTouched: at(9), log: [entry("1", 9, "x")] });
    const { stream, loserLostFields } = mergeStreams(s, { ...s }, NOW);
    expect(loserLostFields).toBe(false);
    expect(stream.log).toHaveLength(1);
  });

  it("refuses to merge two different streams", () => {
    const a = base({ id: ID });
    const b = base({ id: "33333333-3333-4333-8333-333333333333" });
    expect(() => mergeStreams(a, b, NOW)).toThrow(/different streams/);
  });

  it("a tie is resolved stably rather than thrown", () => {
    const a = base({ title: "A", lastTouched: at(9) });
    const b = base({ title: "B", lastTouched: at(9) });
    expect(mergeStreams(a, b, NOW).stream.title).toBe("A");
  });

  it("the merged result is schema-valid and saveable", () => {
    const a = base({ state: "parked", wakeUpDate: "2026-08-01", lastTouched: at(9) });
    const b = base({ state: "waiting", waitingSince: "2026-07-01", waitingUntil: undefined, lastTouched: at(11) } as Partial<Stream>);
    const { stream } = mergeStreams(a, b, NOW);
    expect(Stream.safeParse(stream).success).toBe(true);
  });

  it("state conflicts resolve wholesale, not field-by-field", () => {
    // Cherry-picking fields across sides could produce parked-with-no-wake-up:
    // a stream the schema rejects and that would rot silently. The winner's
    // state travels with its own supporting fields.
    const parked = base({ state: "parked", wakeUpDate: "2026-08-01", waitingSince: null, lastTouched: at(9) });
    const waiting = base({ state: "waiting", waitingSince: "2026-07-01", wakeUpDate: null, lastTouched: at(11) });
    const { stream } = mergeStreams(parked, waiting, NOW);
    expect(stream.state).toBe("waiting");
    expect(stream.waitingSince).toBe("2026-07-01");
    expect(stream.wakeUpDate).toBeNull();
    expect(Stream.safeParse(stream).success).toBe(true);
  });

  it("merging is idempotent — re-merging a merged result changes nothing material", () => {
    const a = base({ title: "old", lastTouched: at(9), log: [entry("1", 9, "a")] });
    const b = base({ title: "new", lastTouched: at(11), log: [entry("2", 10, "b")] });
    const once = mergeStreams(a, b, NOW).stream;
    const twice = mergeStreams(once, { ...once }, NOW).stream;
    expect(twice.title).toBe(once.title);
    expect(twice.log).toHaveLength(once.log.length);
  });
});

describe("the three races PLAN M6 named", () => {
  it("concurrent scalar edits: newest wins, nothing else is disturbed", () => {
    const a = base({ title: "renamed on A", lastTouched: at(9) });
    const b = base({ outcome: "reworded on B", lastTouched: at(11) });
    const { stream } = mergeStreams(a, b, NOW);
    // B is newer, so B's whole record wins -- including its unchanged title.
    expect(stream.outcome).toBe("reworded on B");
    expect(stream.title).toBe("S");
  });

  it("concurrent log appends: both survive, losslessly", () => {
    const a = base({ lastTouched: at(9), log: [newLogEntry("manual", "note A", new Date(at(9)))] });
    const b = base({ lastTouched: at(11), log: [newLogEntry("manual", "note B", new Date(at(11)))] });
    const texts = mergeStreams(a, b, NOW).stream.log.map((e) => e.text);
    expect(texts).toContain("note A");
    expect(texts).toContain("note B");
  });

  it("edit-vs-delete: merge is not involved — a surviving file means a surviving stream", () => {
    // Deletion isn't a value we can merge: the sync daemon decides whether the
    // file comes back. Our contract is only that if a file arrives, it loads.
    // Documented so the absence of a merge rule here is a choice, not a gap.
    const edited = base({ title: "edited on A", lastTouched: at(11) });
    expect(Stream.safeParse(edited).success).toBe(true);
  });
});
