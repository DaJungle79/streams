import { IsoDay } from "../models/common";
import { Stream } from "../models/stream";
import { daysBetween, toDay } from "./days";

/**
 * Everything currently waiting on someone else, grouped by person (SPEC §3.1).
 *
 * Grouped by *person*, not by stream, because the action this view exists to
 * produce is "chase Bob" -- and chasing Bob about four things is one
 * conversation, not four.
 */

export type WaitingEntry = { stream: Stream; days: number };
export type WaitingPerson = { name: string; entries: WaitingEntry[]; longestDays: number };

export function waitingByPerson(streams: Stream[], now: Date): WaitingPerson[] {
  const today: IsoDay = toDay(now);
  const byName = new Map<string, WaitingEntry[]>();

  for (const stream of streams) {
    if (stream.state !== "waiting") continue;
    // A waiting stream owned by "me" is incoherent (§1: waiting means someone
    // else owes the step). The UI prevents it; if one exists anyway, it doesn't
    // belong in a view about chasing other people.
    if (stream.nextStep?.owner.kind !== "person") continue;

    const name = stream.nextStep.owner.name;
    const days = stream.waitingSince ? daysBetween(stream.waitingSince, today) : 0;
    byName.set(name, [...(byName.get(name) ?? []), { stream, days }]);
  }

  return [...byName.entries()]
    .map(([name, entries]) => ({
      name,
      entries: entries.sort((a, b) => b.days - a.days),
      longestDays: Math.max(...entries.map((e) => e.days)),
    }))
    // Longest wait first: the person you've been sitting on longest is the one
    // most likely to have quietly dropped it.
    .sort((a, b) => b.longestDays - a.longestDays || a.name.localeCompare(b.name));
}

/** Autocomplete source (SPEC §3.1: "free-text name with autocomplete from previously used names"). */
export function knownPeople(streams: Stream[]): string[] {
  const names = new Set<string>();
  for (const s of streams) {
    if (s.nextStep?.owner.kind === "person") names.add(s.nextStep.owner.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
