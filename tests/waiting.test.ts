import { describe, expect, it } from "vitest";
import { addDays, toDay } from "../src/core/days";
import { knownPeople, waitingByPerson } from "../src/core/waiting";
import { Stream, newStream } from "../src/models/stream";

const AREA = "11111111-1111-4111-8111-111111111111";
const NOW = new Date(2026, 6, 17, 9, 0, 0);
const TODAY = toDay(NOW);

const waitingOn = (name: string, daysAgo: number, title = name): Stream => ({
  ...newStream(title, AREA, NOW),
  state: "waiting",
  waitingSince: addDays(TODAY, -daysAgo),
  nextStep: { text: "review", owner: { kind: "person", name }, setAt: TODAY },
});

describe("waitingByPerson", () => {
  it("groups several streams under one person — chasing Bob is one conversation", () => {
    const g = waitingByPerson([waitingOn("Bob", 3, "a"), waitingOn("Bob", 9, "b")], NOW);
    expect(g).toHaveLength(1);
    expect(g[0].name).toBe("Bob");
    expect(g[0].entries).toHaveLength(2);
  });

  it("sorts people by longest wait — the oldest is likeliest to have been dropped", () => {
    const g = waitingByPerson([waitingOn("Ann", 2), waitingOn("Bob", 20), waitingOn("Cat", 9)], NOW);
    expect(g.map((p) => p.name)).toEqual(["Bob", "Cat", "Ann"]);
  });

  it("sorts each person's entries by longest wait", () => {
    const g = waitingByPerson([waitingOn("Bob", 1, "new"), waitingOn("Bob", 30, "old")], NOW);
    expect(g[0].entries.map((e) => e.stream.title)).toEqual(["old", "new"]);
    expect(g[0].longestDays).toBe(30);
  });

  it("reports days waited", () => {
    expect(waitingByPerson([waitingOn("Bob", 12)], NOW)[0].entries[0].days).toBe(12);
  });

  it("ignores non-waiting streams", () => {
    const active = { ...waitingOn("Bob", 5), state: "active" as const, waitingSince: null };
    expect(waitingByPerson([active], NOW)).toEqual([]);
  });

  it("ignores a waiting stream owned by me — this view is about chasing others", () => {
    const mine: Stream = {
      ...waitingOn("Bob", 5),
      nextStep: { text: "review", owner: { kind: "me" }, setAt: TODAY },
    };
    expect(waitingByPerson([mine], NOW)).toEqual([]);
  });

  it("ignores a waiting stream with no next step", () => {
    expect(waitingByPerson([{ ...waitingOn("Bob", 5), nextStep: null }], NOW)).toEqual([]);
  });

  it("distinct names stay distinct, and ties break by name", () => {
    const g = waitingByPerson([waitingOn("Bob", 5), waitingOn("Ann", 5)], NOW);
    expect(g.map((p) => p.name)).toEqual(["Ann", "Bob"]);
  });

  it("empty in, empty out", () => expect(waitingByPerson([], NOW)).toEqual([]));
});

describe("knownPeople", () => {
  it("collects names across all states, for autocomplete (§3.1)", () => {
    const done: Stream = {
      ...newStream("old", AREA, NOW),
      state: "done",
      nextStep: { text: "x", owner: { kind: "person", name: "Zoe" }, setAt: TODAY },
    };
    expect(knownPeople([waitingOn("Bob", 1), done])).toEqual(["Bob", "Zoe"]);
  });

  it("de-duplicates and sorts", () => {
    expect(knownPeople([waitingOn("Bob", 1, "a"), waitingOn("Bob", 2, "b"), waitingOn("Ann", 1)])).toEqual([
      "Ann",
      "Bob",
    ]);
  });

  it("no people, no names", () => {
    expect(knownPeople([newStream("x", AREA, NOW)])).toEqual([]);
  });
});
