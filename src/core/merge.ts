import { LogEntry, newLogEntry } from "../models/logEntry";
import { Stream } from "../models/stream";

/**
 * Conflict resolution (SPEC §6).
 *
 * Two Macs edited the same stream while offline, and the sync daemon handed us
 * both. This decides what survives.
 *
 * The rule that matters is the second one: **no log entry is ever lost.** Scalar
 * fields are last-write-wins, so one side's title edit can lose — annoying, and
 * recoverable by typing it again. The log is the stream's memory (§3.3, §8), and
 * a lost entry is unrecoverable. Since entries are append-only with stable ids,
 * union is not a heuristic: it is exactly correct.
 */

/** Union by id, newest first. Neither side can lose an entry. */
export function mergeLogs(a: LogEntry[], b: LogEntry[]): LogEntry[] {
  const byId = new Map<string, LogEntry>();
  // `a` first so its copy wins an id collision; identical ids mean identical
  // entries anyway, since ids are generated with the entry.
  for (const e of [...b, ...a]) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => y.at.localeCompare(x.at) || x.id.localeCompare(y.id));
}

export type MergeResult = { stream: Stream; loserLostFields: boolean };

/**
 * Merge two versions of the same stream.
 *
 * `now` stamps the automatic `conflict-merged` entry: SPEC §6 requires the merge
 * be loud, never silent. A merge you can't see is indistinguishable from data
 * loss you haven't noticed.
 */
export function mergeStreams(a: Stream, b: Stream, now: Date): MergeResult {
  if (a.id !== b.id) {
    throw new Error(`refusing to merge different streams: ${a.id} vs ${b.id}`);
  }

  // Last-write-wins on lastTouched. Ties go to `a` — arbitrary but stable, and
  // a tie means both Macs wrote within the same millisecond, which for a
  // single-user tool means one of them is a duplicate of the other.
  const [winner, loser] = a.lastTouched >= b.lastTouched ? [a, b] : [b, a];

  const log = mergeLogs(a.log, b.log);

  // Did the losing side actually have distinct field values? If not, this was a
  // duplicate rather than a conflict, and saying "merged" would be noise.
  const loserLostFields = !sameFields(winner, loser);

  const merged: Stream = {
    ...winner,
    log,
    lastTouched: winner.lastTouched,
  };

  if (loserLostFields) {
    merged.log = [
      newLogEntry(
        "conflict-merged",
        `merged an edit from another device; kept the newer version (${winner.lastTouched})`,
        now,
      ),
      ...log,
    ];
  }

  return { stream: merged, loserLostFields };
}

/** Everything except the log and the timestamp — i.e. what LWW actually decides. */
function sameFields(x: Stream, y: Stream): boolean {
  const strip = (s: Stream) => {
    const { log: _log, lastTouched: _lt, ...rest } = s;
    return JSON.stringify(rest);
  };
  return strip(x) === strip(y);
}
