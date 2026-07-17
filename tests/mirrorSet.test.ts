import { describe, expect, it } from "vitest";
import { MirrorItem, ReminderMap, isPlanEmpty, mirrorSet, planMirror } from "../src/core/mirrorSet";
import { Area } from "../src/models/area";
import { Stream, newStream } from "../src/models/stream";

const AREA_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date(2026, 6, 17, 9, 0, 0);
const areas: Area[] = [{ id: AREA_ID, name: "Acme", color: "#6b7fd7" }];

const myStep = { text: "call the auditors", owner: { kind: "me" } as const, setAt: "2026-07-17" };
const theirStep = {
  text: "review the pack",
  owner: { kind: "person", name: "Bob" } as const,
  setAt: "2026-07-17",
};

const s = (o: Partial<Stream> = {}): Stream => ({
  ...newStream("Audit", AREA_ID, NOW),
  nextStep: myStep,
  ...o,
});

describe("mirrorSet — what belongs in Reminders", () => {
  it("mirrors an active stream whose step is mine", () => {
    const m = mirrorSet([s()], areas);
    expect(m).toHaveLength(1);
    expect(m[0].title).toBe("call the auditors");
  });

  it("does NOT mirror a step owned by someone else — you can't do it (§3.1)", () => {
    expect(mirrorSet([s({ state: "waiting", waitingSince: "2026-07-17", nextStep: theirStep })], areas)).toHaveLength(0);
  });

  it("does not mirror an active stream whose step is someone else's", () => {
    expect(mirrorSet([s({ nextStep: theirStep })], areas)).toHaveLength(0);
  });

  it("does not mirror a stream with no next step", () => {
    expect(mirrorSet([s({ nextStep: null })], areas)).toHaveLength(0);
  });

  it("does not mirror parked or done streams", () => {
    expect(mirrorSet([s({ state: "parked", wakeUpDate: "2026-08-01" })], areas)).toHaveLength(0);
    expect(mirrorSet([s({ state: "done" })], areas)).toHaveLength(0);
  });

  it("the reminder's title is the step, not the stream — it's the thing to do", () => {
    expect(mirrorSet([s({ title: "Acme audit" })], areas)[0].title).toBe("call the auditors");
  });

  it("notes carry the stream, area and outcome for context", () => {
    const n = mirrorSet([s({ title: "Acme audit", outcome: "signed accounts" })], areas)[0].notes;
    expect(n).toContain("Stream: Acme audit (Acme)");
    expect(n).toContain("Outcome: signed accounts");
    expect(n).toContain("not read back");
  });

  it("omits an empty outcome rather than printing a blank label", () => {
    expect(mirrorSet([s({ outcome: "   " })], areas)[0].notes).not.toContain("Outcome:");
  });
});

describe("due dates — the fuzzy-deadline rule", () => {
  it("a milestone date becomes the due date: it's concrete (§1)", () => {
    const m = mirrorSet([s({ nextMilestone: { text: "board pack", date: "2026-09-14" } })], areas);
    expect(m[0].dueDate).toBe("2026-09-14");
  });

  it("a fuzzy target deadline NEVER becomes a due date", () => {
    // The whole point of §1: "end of Q3 2026" is a window. Turning it into
    // 2026-09-01 would nag you on a date you never chose.
    const m = mirrorSet(
      [s({ targetDeadline: { label: "end of Q3 2026", earliest: "2026-09-01", latest: "2026-09-30" } })],
      areas,
    );
    expect(m[0].dueDate).toBeNull();
  });

  it("the fuzzy label rides along in the notes instead", () => {
    const m = mirrorSet(
      [s({ targetDeadline: { label: "end of Q3 2026", earliest: "2026-09-01", latest: "2026-09-30" } })],
      areas,
    );
    expect(m[0].notes).toContain("Target: end of Q3 2026");
    expect(m[0].notes).not.toContain("2026-09-01");
  });

  it("a milestone wins even when a fuzzy deadline is also set", () => {
    const m = mirrorSet(
      [
        s({
          targetDeadline: { label: "end of Q3 2026", earliest: "2026-09-01", latest: "2026-09-30" },
          nextMilestone: { text: "board pack", date: "2026-08-01" },
        }),
      ],
      areas,
    );
    expect(m[0].dueDate).toBe("2026-08-01");
  });
});

describe("fingerprint — what counts as a change", () => {
  const fp = (o: Partial<Stream>) => mirrorSet([s(o)], areas)[0].fingerprint;

  it("changes when the step text changes", () => {
    expect(fp({})).not.toBe(fp({ nextStep: { ...myStep, text: "email the auditors" } }));
  });

  it("changes when the milestone date changes", () => {
    expect(fp({ nextMilestone: { text: "m", date: "2026-08-01" } })).not.toBe(
      fp({ nextMilestone: { text: "m", date: "2026-09-01" } }),
    );
  });

  it("changes when the outcome changes — it's in the notes", () => {
    expect(fp({ outcome: "a" })).not.toBe(fp({ outcome: "b" }));
  });

  it("does NOT change for things the reminder never shows", () => {
    // A cadence tweak or a priority flag must not churn Reminders.
    expect(fp({})).toBe(fp({ checkInCadenceDays: 14 }));
    expect(fp({})).toBe(fp({ priority: "high" }));
    expect(fp({})).toBe(fp({ lastTouched: new Date().toISOString() }));
  });
});

describe("planMirror", () => {
  const item = (): MirrorItem => mirrorSet([s({ id: "abc" })], areas)[0];

  it("creates what isn't there yet", () => {
    const p = planMirror([item()], {});
    expect(p.creates).toHaveLength(1);
    expect(p.updates).toHaveLength(0);
    expect(p.deletes).toHaveLength(0);
  });

  it("does nothing when the fingerprint matches", () => {
    const i = item();
    const map: ReminderMap = { [i.streamId]: { reminderId: "r1", fingerprint: i.fingerprint } };
    expect(isPlanEmpty(planMirror([i], map))).toBe(true);
  });

  it("updates when the fingerprint moved", () => {
    const i = item();
    const map: ReminderMap = { [i.streamId]: { reminderId: "r1", fingerprint: "stale" } };
    const p = planMirror([i], map);
    expect(p.updates).toEqual([{ item: i, reminderId: "r1" }]);
  });

  it("deletes when a stream leaves the set", () => {
    const map: ReminderMap = { gone: { reminderId: "r9", fingerprint: "x" } };
    const p = planMirror([], map);
    expect(p.deletes).toEqual([{ streamId: "gone", reminderId: "r9" }]);
  });

  it("completing a step removes its reminder", () => {
    const before = mirrorSet([s({ id: "abc" })], areas)[0];
    const map: ReminderMap = { abc: { reminderId: "r1", fingerprint: before.fingerprint } };
    const after = mirrorSet([s({ id: "abc", nextStep: null })], areas);
    expect(planMirror(after, map).deletes).toEqual([{ streamId: "abc", reminderId: "r1" }]);
  });

  it("reassigning a step to a person removes its reminder", () => {
    const before = mirrorSet([s({ id: "abc" })], areas)[0];
    const map: ReminderMap = { abc: { reminderId: "r1", fingerprint: before.fingerprint } };
    const after = mirrorSet([s({ id: "abc", nextStep: theirStep })], areas);
    expect(planMirror(after, map).deletes).toHaveLength(1);
  });

  it("parking a stream removes its reminder", () => {
    const before = mirrorSet([s({ id: "abc" })], areas)[0];
    const map: ReminderMap = { abc: { reminderId: "r1", fingerprint: before.fingerprint } };
    const after = mirrorSet([s({ id: "abc", state: "parked", wakeUpDate: "2026-08-01" })], areas);
    expect(planMirror(after, map).deletes).toHaveLength(1);
  });

  it("is idempotent — replanning after applying does nothing, so no duplicates", () => {
    const i = item();
    const applied: ReminderMap = { [i.streamId]: { reminderId: "r1", fingerprint: i.fingerprint } };
    expect(isPlanEmpty(planMirror([i], applied))).toBe(true);
  });

  it("a full startup reconcile against a correct map is a no-op", () => {
    const desired = mirrorSet([s({ id: "a" }), s({ id: "b", title: "Other" })], areas);
    const map: ReminderMap = Object.fromEntries(
      desired.map((d, n) => [d.streamId, { reminderId: `r${n}`, fingerprint: d.fingerprint }]),
    );
    expect(isPlanEmpty(planMirror(desired, map))).toBe(true);
  });
});
