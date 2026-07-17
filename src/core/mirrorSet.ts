import { IsoDay } from "../models/common";
import { Area } from "../models/area";
import { Stream } from "../models/stream";

/**
 * What *should* exist in Reminders (SPEC §4.5). A pure projection.
 *
 * One-way, always: Streams is the source of truth and Reminders is a view of it.
 * This function decides *what should be there*; `remindersMirror` decides what to
 * change; `reminders.rs` only shells out. So the rules below are testable
 * without Reminders.app running.
 */

export type MirrorItem = {
  streamId: string;
  /** The reminder's title: the step itself, because that's the thing to do. */
  title: string;
  notes: string;
  /**
   * Only ever a milestone date (SPEC §1: concrete). A fuzzy target deadline
   * never becomes a due date -- "end of Q3" is a window, and turning it into
   * 2026-09-01 would have your phone nagging you on a date you never chose.
   * The label goes in the notes as text instead.
   */
  dueDate: IsoDay | null;
  /** Changes iff something the reminder displays changed. Drives updates. */
  fingerprint: string;
};

function notesFor(stream: Stream, area: Area | undefined): string {
  const lines = [`Stream: ${stream.title}${area ? ` (${area.name})` : ""}`];
  if (stream.outcome.trim()) lines.push(`Outcome: ${stream.outcome.trim()}`);
  // The label, never earliest/latest: the label is what the user actually meant.
  if (stream.targetDeadline) lines.push(`Target: ${stream.targetDeadline.label}`);
  lines.push("", "Managed by Streams — edits here are not read back.");
  return lines.join("\n");
}

/**
 * Active streams whose next step is mine.
 *
 * Not waiting-on-others (§3.1): those aren't actionable by you, and a to-do list
 * full of things you can't do is a list you stop reading. Not parked or done:
 * they have no live next step to mirror.
 */
export function mirrorSet(streams: Stream[], areas: Area[]): MirrorItem[] {
  const areaById = new Map(areas.map((a) => [a.id, a]));

  return streams
    .filter((s) => s.state === "active")
    .filter((s) => s.nextStep !== null && s.nextStep.owner.kind === "me")
    .map((s) => {
      const title = s.nextStep!.text;
      const notes = notesFor(s, areaById.get(s.areaId));
      const dueDate = s.nextMilestone?.date ?? null;
      return {
        streamId: s.id,
        title,
        notes,
        dueDate,
        // Only what the reminder shows. A cadence change or a state change that
        // keeps the stream in the set must not churn Reminders.
        fingerprint: JSON.stringify([title, notes, dueDate]),
      };
    })
    .sort((a, b) => a.streamId.localeCompare(b.streamId));
}

/** streamId -> what we last created there. Machine-local (SPEC §4.5). */
export type ReminderMap = Record<string, { reminderId: string; fingerprint: string }>;

export type MirrorPlan = {
  creates: MirrorItem[];
  updates: { item: MirrorItem; reminderId: string }[];
  /** Reminders whose stream left the set: step done, reassigned, parked, done. */
  deletes: { streamId: string; reminderId: string }[];
};

/**
 * Diff desired against what we last wrote. Pure, so the interesting half of the
 * mirror is testable with no Apple Events involved.
 */
export function planMirror(desired: MirrorItem[], map: ReminderMap): MirrorPlan {
  const plan: MirrorPlan = { creates: [], updates: [], deletes: [] };
  const wanted = new Set(desired.map((d) => d.streamId));

  for (const item of desired) {
    const known = map[item.streamId];
    if (!known) plan.creates.push(item);
    else if (known.fingerprint !== item.fingerprint) {
      plan.updates.push({ item, reminderId: known.reminderId });
    }
  }

  for (const [streamId, { reminderId }] of Object.entries(map)) {
    if (!wanted.has(streamId)) plan.deletes.push({ streamId, reminderId });
  }

  return plan;
}

export function isPlanEmpty(p: MirrorPlan): boolean {
  return p.creates.length === 0 && p.updates.length === 0 && p.deletes.length === 0;
}
