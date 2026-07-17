import { LogEntry, newLogEntry } from "../models/logEntry";
import { Stream, StepOwner } from "../models/stream";

/**
 * Automatic log entries for structural events (SPEC §3.3).
 *
 * A pure diff: `before + after -> LogEntry[]`. Keeping it out of the UI means
 * the log can't drift depending on *which* screen made the change, and it means
 * this -- the thing that makes a six-week-old stream re-readable in under a
 * minute (§8) -- is testable without rendering anything.
 *
 * Deliberately narrow. Only changes that alter *what the stream is doing* are
 * logged. Retyping the outcome or nudging a cadence is bookkeeping; logging it
 * would bury the decisions under noise, and the log's whole value is that
 * everything in it is worth reading.
 */

const ownerName = (o: StepOwner) => (o.kind === "me" ? "me" : o.name);

function sameOwner(a: StepOwner, b: StepOwner): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "me" || a.name === (b as { name: string }).name;
}

export function structuralEvents(before: Stream, after: Stream, now: Date): LogEntry[] {
  const out: LogEntry[] = [];
  const log = (kind: Parameters<typeof newLogEntry>[0], text: string) =>
    out.push(newLogEntry(kind, text, now));

  if (before.state !== after.state) {
    log("state-changed", `${before.state} → ${after.state}`);
  }

  const bs = before.nextStep;
  const as = after.nextStep;

  if (bs && !as) {
    // Cleared. `completeStep` logs its own richer entry before calling us, so
    // this catches the other route: emptying the field by hand.
    log("step-completed", `step cleared: ${bs.text}`);
  } else if (!bs && as) {
    log("step-changed", `next step: ${as.text} (${ownerName(as.owner)})`);
  } else if (bs && as) {
    if (bs.text !== as.text) log("step-changed", `next step: ${bs.text} → ${as.text}`);
    if (!sameOwner(bs.owner, as.owner)) {
      log("owner-changed", `${ownerName(bs.owner)} → ${ownerName(as.owner)}`);
    }
  }

  const bd = before.targetDeadline;
  const ad = after.targetDeadline;
  if (bd?.label !== ad?.label) {
    // The label, not the window: "end of Q3" is the decision; 2026-09-01 is the
    // parser's arithmetic, and logging it would misreport what the user chose.
    if (!bd && ad) log("deadline-changed", `deadline set: ${ad.label}`);
    else if (bd && !ad) log("deadline-changed", `deadline cleared (was ${bd.label})`);
    else if (bd && ad) log("deadline-changed", `deadline: ${bd.label} → ${ad.label}`);
  }

  return out;
}
