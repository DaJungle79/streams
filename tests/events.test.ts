import { describe, expect, it } from "vitest";
import { structuralEvents } from "../src/core/events";
import { withState } from "../src/core/transitions";
import { Stream, newStream } from "../src/models/stream";

const AREA = "11111111-1111-4111-8111-111111111111";
const NOW = new Date(2026, 6, 17, 9, 0, 0);
const base = () => newStream("S", AREA, NOW);
const step = (text: string, owner: Stream["nextStep"] extends null ? never : any = { kind: "me" }) => ({
  text,
  owner,
  setAt: "2026-07-17",
});

const kinds = (b: Stream, a: Stream) => structuralEvents(b, a, NOW).map((e) => e.kind);
const texts = (b: Stream, a: Stream) => structuralEvents(b, a, NOW).map((e) => e.text);

describe("no change", () => {
  it("logs nothing", () => {
    const s = base();
    expect(structuralEvents(s, s, NOW)).toEqual([]);
  });

  it("bookkeeping is not a structural event — the log must stay worth reading", () => {
    const b = base();
    for (const a of [
      { ...b, outcome: "a whole new outcome" },
      { ...b, checkInCadenceDays: 14 },
      { ...b, priority: "high" as const },
      { ...b, title: "renamed" },
      { ...b, areaId: "22222222-2222-4222-8222-222222222222" },
      { ...b, lastTouched: new Date().toISOString() },
    ]) {
      expect(structuralEvents(b, a, NOW), JSON.stringify(a).slice(0, 40)).toEqual([]);
    }
  });
});

describe("state", () => {
  it("logs a transition", () => {
    const b = base();
    const a = withState(b, "parked", NOW);
    expect(kinds(b, a)).toEqual(["state-changed"]);
    expect(texts(b, a)).toEqual(["active → parked"]);
  });
});

describe("next step", () => {
  it("logs a step being set", () => {
    const b = base();
    const a = { ...b, nextStep: step("call Bob") };
    expect(kinds(b, a)).toEqual(["step-changed"]);
    expect(texts(b, a)).toEqual(["next step: call Bob (me)"]);
  });

  it("logs a step being reworded", () => {
    const b = { ...base(), nextStep: step("call Bob") };
    const a = { ...b, nextStep: step("email Bob") };
    expect(texts(b, a)).toEqual(["next step: call Bob → email Bob"]);
  });

  it("logs a step being cleared by hand", () => {
    const b = { ...base(), nextStep: step("call Bob") };
    const a = { ...b, nextStep: null };
    expect(kinds(b, a)).toEqual(["step-completed"]);
  });

  it("logs a handover to a person", () => {
    const b = { ...base(), nextStep: step("review", { kind: "me" }) };
    const a = { ...b, nextStep: step("review", { kind: "person", name: "Bob" }) };
    expect(kinds(b, a)).toEqual(["owner-changed"]);
    expect(texts(b, a)).toEqual(["me → Bob"]);
  });

  it("logs a handover between two people", () => {
    const b = { ...base(), nextStep: step("review", { kind: "person", name: "Bob" }) };
    const a = { ...b, nextStep: step("review", { kind: "person", name: "Ann" }) };
    expect(texts(b, a)).toEqual(["Bob → Ann"]);
  });

  it("does NOT log an owner change when the person is the same", () => {
    const b = { ...base(), nextStep: step("review", { kind: "person", name: "Bob" }) };
    const a = { ...b, nextStep: step("review", { kind: "person", name: "Bob" }) };
    expect(structuralEvents(b, a, NOW)).toEqual([]);
  });

  it("logs both when text and owner change together", () => {
    const b = { ...base(), nextStep: step("draft", { kind: "me" }) };
    const a = { ...b, nextStep: step("review draft", { kind: "person", name: "Bob" }) };
    expect(kinds(b, a)).toEqual(["step-changed", "owner-changed"]);
  });
});

describe("deadline", () => {
  const d = (label: string) => ({ label, earliest: "2026-09-01", latest: "2026-09-30" });

  it("logs a deadline being set", () => {
    const b = base();
    const a = { ...b, targetDeadline: d("end of Q3 2026") };
    expect(texts(b, a)).toEqual(["deadline set: end of Q3 2026"]);
  });

  it("logs a deadline being cleared", () => {
    const b = { ...base(), targetDeadline: d("end of Q3 2026") };
    const a = { ...b, targetDeadline: null };
    expect(texts(b, a)).toEqual(["deadline cleared (was end of Q3 2026)"]);
  });

  it("logs the label, never the parsed window — the label is the decision", () => {
    const b = { ...base(), targetDeadline: d("end of Q3 2026") };
    const a = { ...b, targetDeadline: { label: "mid October", earliest: "2026-10-11", latest: "2026-10-20" } };
    expect(texts(b, a)).toEqual(["deadline: end of Q3 2026 → mid October"]);
    expect(texts(b, a)[0]).not.toContain("2026-10-11");
  });

  it("does NOT log when only the window moved under an unchanged label", () => {
    // e.g. the parser is improved and re-reads the same words differently. The
    // user decided nothing; logging it would be the app talking to itself.
    const b = { ...base(), targetDeadline: d("end of Q3 2026") };
    const a = { ...b, targetDeadline: { label: "end of Q3 2026", earliest: "2026-09-02", latest: "2026-09-29" } };
    expect(structuralEvents(b, a, NOW)).toEqual([]);
  });
});

describe("entry shape", () => {
  it("entries carry distinct ids — log merging unions by id (SPEC §6)", () => {
    const b = { ...base(), nextStep: step("draft", { kind: "me" }) };
    const a = { ...withState(b, "waiting", NOW), nextStep: step("review", { kind: "person", name: "Bob" }) };
    const ids = structuralEvents(b, a, NOW).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(1);
  });
});
