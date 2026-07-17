import { z } from "zod";
import { IsoInstant, Uuid } from "./common";

/**
 * Manual notes and automatic structural events share one shape, discriminated
 * by `kind` (SPEC §3.3).
 *
 * `conflict-merged` is not a user action -- it is the sync layer confessing
 * that it resolved a collision (SPEC §6). A merge must never be silent.
 */
export const LogEntryKind = z.enum([
  "manual",
  "step-completed",
  "step-changed",
  "owner-changed",
  "state-changed",
  "deadline-changed",
  "checked-in",
  "nudge-sent",
  "conflict-merged",
]);
export type LogEntryKind = z.infer<typeof LogEntryKind>;

export const LogEntry = z.object({
  /**
   * Stable and client-generated. This id is what makes log merging lossless:
   * two Macs that each appended offline union by id, and neither loses an
   * entry (SPEC §6).
   */
  id: Uuid,
  at: IsoInstant,
  kind: LogEntryKind,
  text: z.string(),
});

export type LogEntry = z.infer<typeof LogEntry>;

export function newLogEntry(
  kind: LogEntryKind,
  text: string,
  now: Date,
): LogEntry {
  return {
    id: crypto.randomUUID(),
    at: now.toISOString(),
    kind,
    text,
  };
}
