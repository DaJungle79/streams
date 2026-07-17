import { IsoDay } from "../models/common";
import { Stream } from "../models/stream";
import { daysBetween, daysSince, toDay } from "./days";

/**
 * `Stream[] + today -> AttentionItem[]` (SPEC §2). A pure function.
 *
 * The entire product promise lives here: *no stream can silently rot* (SPEC §8).
 * Everything downstream -- the main view, the tray count, the daily digest --
 * only renders what this decides.
 */

export type AttentionReason =
  | "waking-up"
  | "no-next-step"
  | "deadline-window"
  | "waiting-too-long"
  | "check-in-overdue";

export type AttentionItem = {
  stream: Stream;
  reason: AttentionReason;
  /** Human phrasing of *why this is here*, shown on the row (SPEC §2). */
  detail: string;
  /**
   * How overdue, in days, within this reason. Sorts the group; not displayed.
   * Larger = more urgent.
   */
  urgency: number;
};

export type AttentionGroup = { reason: AttentionReason; title: string; items: AttentionItem[] };

export type AttentionOptions = {
  /** SPEC §2.4: default 7, configurable. */
  waitingThresholdDays: number;
  /** SPEC §2.3: milestone "within 7 days". */
  milestoneHorizonDays: number;
};

export const DEFAULT_OPTIONS: AttentionOptions = {
  waitingThresholdDays: 7,
  milestoneHorizonDays: 7,
};

/** Display order, straight from SPEC §2's own numbering. */
const GROUP_ORDER: AttentionReason[] = [
  "no-next-step",
  "check-in-overdue",
  "deadline-window",
  "waiting-too-long",
  "waking-up",
];

export const GROUP_TITLES: Record<AttentionReason, string> = {
  "no-next-step": "No next step",
  "check-in-overdue": "Check-in overdue",
  "deadline-window": "Deadline window open",
  "waiting-too-long": "Waiting too long",
  "waking-up": "Waking up today",
};

/**
 * Which reason wins when a stream trips several.
 *
 * SPEC §2 groups by reason and each row shows "the reason it's here" -- singular
 * -- so a stream appears **once**, under its most actionable trigger. The
 * alternative (listing it under every trigger) inflates the tray count against
 * §4.1's "number of streams", and teaches you to skim a view whose only job is
 * to be worth reading.
 *
 * Ordered by how concrete the required action is:
 *  1. waking-up        -- a parked stream is asking for a triage decision today.
 *  2. no-next-step     -- the stream is adrift; nothing else matters until it isn't.
 *  3. deadline-window  -- real time pressure, from a date the user chose.
 *  4. waiting-too-long -- concrete action: go nudge a named person.
 *  5. check-in-overdue -- the weakest signal: "you haven't looked lately". It is
 *     satisfied by *any* touch (§3.2), so acting on any reason above clears it
 *     too. Showing it in preference to a concrete reason would bury the lede.
 */
const PRECEDENCE: AttentionReason[] = [
  "waking-up",
  "no-next-step",
  "deadline-window",
  "waiting-too-long",
  "check-in-overdue",
];

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** Every reason a stream currently trips, unordered. */
function reasonsFor(stream: Stream, today: IsoDay, opts: AttentionOptions): AttentionItem[] {
  // `done` streams live in the Archive (§5.2) and are never surfaced.
  if (stream.state === "done") return [];

  const out: AttentionItem[] = [];
  const push = (reason: AttentionReason, detail: string, urgency: number) =>
    out.push({ stream, reason, detail, urgency });

  // §2.5 — parked streams whose wake-up date arrived.
  if (stream.state === "parked" && stream.wakeUpDate && stream.wakeUpDate <= today) {
    const late = daysBetween(stream.wakeUpDate, today);
    push("waking-up", late === 0 ? "woke up today" : `woke up ${plural(late, "day")} ago`, late);
  }

  // A parked stream is *deliberately* dormant. Its wake-up date is its only
  // trigger -- nagging about a deadline you chose to ignore until October is
  // exactly the noise that gets the whole view tuned out.
  if (stream.state === "parked") return out;

  // §2.1 — active streams with no next step.
  if (stream.state === "active" && stream.nextStep === null) {
    push("no-next-step", "no next step", daysSince(stream.lastTouched, today));
  }

  // §2.3 — deadline window opened, or milestone within the horizon.
  if (stream.targetDeadline && stream.targetDeadline.earliest <= today) {
    const open = daysBetween(stream.targetDeadline.earliest, today);
    // The label, never the raw date: "end of Q3 2026" is what the user meant.
    push(
      "deadline-window",
      open === 0
        ? `deadline window opened today — ${stream.targetDeadline.label}`
        : `deadline window open ${plural(open, "day")} — ${stream.targetDeadline.label}`,
      open,
    );
  } else if (stream.nextMilestone) {
    const away = daysBetween(today, stream.nextMilestone.date);
    if (away <= opts.milestoneHorizonDays) {
      push(
        "deadline-window",
        away < 0
          ? `milestone ${plural(-away, "day")} overdue — ${stream.nextMilestone.text}`
          : away === 0
            ? `milestone today — ${stream.nextMilestone.text}`
            : `milestone in ${plural(away, "day")} — ${stream.nextMilestone.text}`,
        -away,
      );
    }
  }

  // §2.4 — waiting on someone else for too long.
  if (stream.state === "waiting" && stream.waitingSince) {
    const waited = daysBetween(stream.waitingSince, today);
    if (waited > opts.waitingThresholdDays) {
      const who = stream.nextStep?.owner.kind === "person" ? stream.nextStep.owner.name : "someone";
      push("waiting-too-long", `waiting on ${who} for ${plural(waited, "day")}`, waited);
    }
  }

  // §2.2 — cadence elapsed since last touch.
  if (stream.checkInCadenceDays !== null) {
    const since = daysSince(stream.lastTouched, today);
    const over = since - stream.checkInCadenceDays;
    if (over > 0) {
      push("check-in-overdue", `check-in ${plural(over, "day")} overdue`, over);
    }
  }

  return out;
}

/** Flat list, one entry per stream, already sorted for display. */
export function attentionItems(
  streams: Stream[],
  now: Date,
  opts: AttentionOptions = DEFAULT_OPTIONS,
): AttentionItem[] {
  const today = toDay(now);
  const items: AttentionItem[] = [];

  for (const stream of streams) {
    const tripped = reasonsFor(stream, today, opts);
    if (tripped.length === 0) continue;
    // One stream, one reason -- the most actionable it trips.
    const winner = PRECEDENCE.map((r) => tripped.find((t) => t.reason === r)).find(Boolean)!;
    items.push(winner);
  }

  return items.sort(compare);
}

function compare(a: AttentionItem, b: AttentionItem): number {
  const ga = GROUP_ORDER.indexOf(a.reason);
  const gb = GROUP_ORDER.indexOf(b.reason);
  if (ga !== gb) return ga - gb;
  // §2: high priority pins to the top of its group.
  if (a.stream.priority !== b.stream.priority) return a.stream.priority === "high" ? -1 : 1;
  if (a.urgency !== b.urgency) return b.urgency - a.urgency;
  return a.stream.title.localeCompare(b.stream.title);
}

export function attentionGroups(
  streams: Stream[],
  now: Date,
  opts: AttentionOptions = DEFAULT_OPTIONS,
): AttentionGroup[] {
  const items = attentionItems(streams, now, opts);
  return GROUP_ORDER.map((reason) => ({
    reason,
    title: GROUP_TITLES[reason],
    items: items.filter((i) => i.reason === reason),
  })).filter((g) => g.items.length > 0);
}

/**
 * SPEC §4.1: the tray badge is a count of *streams*, not of reasons. Since each
 * stream yields at most one item, that's just the length -- but naming it here
 * keeps the tray from ever drifting from the view.
 */
export function attentionCount(
  streams: Stream[],
  now: Date,
  opts: AttentionOptions = DEFAULT_OPTIONS,
): number {
  return attentionItems(streams, now, opts).length;
}
