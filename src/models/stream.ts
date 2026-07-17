import { z } from "zod";
import { IsoDay, IsoInstant, Uuid } from "./common";
import { FuzzyDate } from "./fuzzyDate";
import { LogEntry } from "./logEntry";

export const StreamState = z.enum(["active", "waiting", "parked", "done"]);
export type StreamState = z.infer<typeof StreamState>;

export const Priority = z.enum(["high", "normal"]);
export type Priority = z.infer<typeof Priority>;

/**
 * Who owes the next step (SPEC §3.1). "me" is not a named person with the name
 * "me" -- it is a distinct case, because the whole Waiting view and the
 * Reminders mirror (§4.5) hinge on "is this mine to do?".
 */
export const StepOwner = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("me") }),
  z.object({ kind: z.literal("person"), name: z.string().min(1) }),
]);
export type StepOwner = z.infer<typeof StepOwner>;

export const NextStep = z.object({
  text: z.string().min(1),
  owner: StepOwner,
  /** SPEC §1 tracks when a step was set, so a stale step is visible as stale. */
  setAt: IsoDay,
});
export type NextStep = z.infer<typeof NextStep>;

export const Milestone = z.object({
  text: z.string().min(1),
  /**
   * Concrete, unlike a target deadline. This is the only date in the model
   * precise enough to become a reminder's due date (SPEC §4.5).
   */
  date: IsoDay,
});
export type Milestone = z.infer<typeof Milestone>;

export const STREAM_SCHEMA_VERSION = 1;

const StreamShape = z.object({
  schemaVersion: z.literal(STREAM_SCHEMA_VERSION),
  id: Uuid,
  title: z.string().min(1),
  areaId: Uuid,
  state: StreamState,
  outcome: z.string(),
  targetDeadline: FuzzyDate.nullable(),
  nextStep: NextStep.nullable(),
  nextMilestone: Milestone.nullable(),
  /** "Review every N days" (SPEC §3.2). Null = no cadence for this stream. */
  checkInCadenceDays: z.number().int().positive().nullable(),
  priority: Priority,
  /** Set when entering `waiting`; drives the "waiting too long" trigger (§2.4). */
  waitingSince: IsoDay.nullable(),
  /** Set when entering `parked`; drives the "waking up today" trigger (§2.5). */
  wakeUpDate: IsoDay.nullable(),
  lastTouched: IsoInstant,
  createdAt: IsoInstant,
  log: z.array(LogEntry),
});

/**
 * Invariants are enforced only where a *missing* value would let a stream rot
 * silently -- the one failure mode the product exists to prevent (SPEC §8).
 *
 * Enforced:
 *  - parked  => wakeUpDate. Without it, nothing ever resurfaces the stream.
 *  - waiting => waitingSince. Without it, "waiting too long" can't be computed.
 *
 * Deliberately NOT enforced:
 *  - active => nextStep. SPEC §1 says an absent next step is *flagged*, not
 *    invalid: it is attention-view group #1 (§2.1). Rejecting it at the schema
 *    would make the app refuse to load exactly the streams it most needs to
 *    shout about.
 *  - waiting => owner is a person. Incoherent, but harmless and self-correcting;
 *    the UI prevents it rather than the parser.
 */
export const Stream = StreamShape.refine(
  (s) => s.state !== "parked" || s.wakeUpDate !== null,
  { message: "a parked stream must have a wake-up date", path: ["wakeUpDate"] },
).refine((s) => s.state !== "waiting" || s.waitingSince !== null, {
  message: "a waiting stream must have a waiting-since date",
  path: ["waitingSince"],
});

export type Stream = z.infer<typeof Stream>;

/**
 * Stamp `lastTouched` (SPEC §1: auto-updated on any edit or log entry).
 *
 * This is not cosmetic. `lastTouched` is what the check-in cadence counts from
 * (§3.2), so any mutation that skips it makes a stream look staler than it is
 * and fires a false check-in overdue. Every write goes through here.
 */
export function touch(stream: Stream, now: Date): Stream {
  return { ...stream, lastTouched: now.toISOString() };
}

export function newStream(
  title: string,
  areaId: string,
  now: Date,
  overrides: Partial<Stream> = {},
): Stream {
  const iso = now.toISOString();
  return {
    schemaVersion: STREAM_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    title,
    areaId,
    state: "active",
    outcome: "",
    targetDeadline: null,
    nextStep: null,
    nextMilestone: null,
    checkInCadenceDays: null,
    priority: "normal",
    waitingSince: null,
    wakeUpDate: null,
    lastTouched: iso,
    createdAt: iso,
    log: [],
    ...overrides,
  };
}
