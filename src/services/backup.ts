import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { Area } from "../models/area";
import { Settings } from "../models/settings";
import { Stream } from "../models/stream";
import { deleteStream, saveAreasNow, saveSettingsNow, saveStreamNow } from "../storage/repository";

/**
 * Whole-store snapshots (see `backup.rs` for why one file, and why one-way).
 *
 * Backup is not sync. Restoring is manual and destructive by design: two Macs
 * auto-restoring each other's snapshots would be whole-store last-write-wins,
 * silently erasing a stream created on the other — the exact failure SPEC §6's
 * per-file merge exists to prevent.
 */

export const Snapshot = z.object({
  snapshotVersion: z.literal(1),
  takenAt: z.iso.datetime(),
  streams: z.array(Stream),
  areas: z.array(Area),
  settings: Settings,
});
export type Snapshot = z.infer<typeof Snapshot>;

export type BackupFile = { filename: string; bytes: number; modified: number };

/** Snapshots to keep. ~50KB each, so 60 is a couple of months for ~3MB. */
const KEEP = 60;

export async function backupDir(): Promise<string | null> {
  return invoke<string | null>("backup_default_dir");
}

export async function listBackups(dir: string): Promise<BackupFile[]> {
  return invoke<BackupFile[]>("backup_list", { dir });
}

function filenameFor(at: Date): string {
  // Colons are illegal in filenames and iCloud dislikes them; the rest of the
  // ISO shape is kept so lexical order stays chronological.
  return `streams-${at.toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
}

export function buildSnapshot(
  streams: Stream[],
  areas: Area[],
  settings: Settings,
  at: Date,
): Snapshot {
  return {
    snapshotVersion: 1,
    takenAt: at.toISOString(),
    // Sorted, so the fingerprint below is stable regardless of load order.
    streams: [...streams].sort((a, b) => a.id.localeCompare(b.id)),
    areas: [...areas].sort((a, b) => a.id.localeCompare(b.id)),
    settings,
  };
}

/**
 * What counts as "the store changed".
 *
 * Excludes `takenAt` (always different) and the settings fields that move on
 * their own — `activeReviewStartedAt` and `lastReviewAt` — so merely opening a
 * review doesn't trigger a snapshot of otherwise identical data.
 */
export function fingerprint(s: Snapshot): string {
  const { activeReviewStartedAt: _a, lastReviewAt: _l, ...settings } = s.settings;
  return JSON.stringify([s.streams, s.areas, settings]);
}

const LAST_FP_KEY = "streams.backup.fingerprint.v1";
const LAST_AT_KEY = "streams.backup.takenAt.v1";

export type BackupResult =
  | { status: "written"; filename: string }
  | { status: "unchanged" }
  | { status: "disabled" }
  | { status: "error"; error: string };

/**
 * Snapshot if the store actually changed since the last one.
 *
 * Deduped by fingerprint rather than by timer: an idle week should cost zero
 * snapshots, and a busy afternoon shouldn't cost sixty. `force` bypasses it for
 * the manual button, because "Back up now" doing nothing looks broken even when
 * it's correct.
 */
export async function backupIfChanged(
  streams: Stream[],
  areas: Area[],
  settings: Settings,
  opts: { force?: boolean } = {},
): Promise<BackupResult> {
  const dir = await backupDir();
  if (dir === null) return { status: "disabled" };

  const at = new Date();
  const snap = buildSnapshot(streams, areas, settings, at);
  const fp = fingerprint(snap);

  if (!opts.force && localStorage.getItem(LAST_FP_KEY) === fp) return { status: "unchanged" };

  // Never snapshot an empty store over a good one: an empty store is far more
  // likely a load failure than a real state, and this is the parachute.
  if (snap.streams.length === 0 && !opts.force) {
    const existing = await listBackups(dir);
    if (existing.length > 0) return { status: "unchanged" };
  }

  const filename = filenameFor(at);
  try {
    await invoke("backup_write", { dir, filename, contents: JSON.stringify(snap, null, 2) });
    localStorage.setItem(LAST_FP_KEY, fp);
    localStorage.setItem(LAST_AT_KEY, at.toISOString());
    await invoke("backup_prune", { dir, keep: KEEP });
    return { status: "written", filename };
  } catch (e) {
    return { status: "error", error: String(e) };
  }
}

export function lastBackupAt(): Date | null {
  const raw = localStorage.getItem(LAST_AT_KEY);
  return raw ? new Date(raw) : null;
}

/** Parse and validate a snapshot. Throws with a readable reason. */
export async function readSnapshot(dir: string, filename: string): Promise<Snapshot> {
  const raw = await invoke<string>("backup_read", { dir, filename });
  return Snapshot.parse(JSON.parse(raw));
}

/**
 * Replace the store with a snapshot. Destructive, and deliberately so — restore
 * means "go back to that state", not "merge that in".
 *
 * It snapshots the *current* state first, forced. Restoring the wrong file is
 * the single most likely way to lose data with this feature, and the fix has to
 * exist before the mistake, not after.
 */
export async function restoreSnapshot(
  snap: Snapshot,
  current: { streams: Stream[]; areas: Area[]; settings: Settings },
): Promise<{ restored: number; removed: number }> {
  await backupIfChanged(current.streams, current.areas, current.settings, { force: true });

  for (const s of snap.streams) await saveStreamNow(s);
  await saveAreasNow(snap.areas);
  await saveSettingsNow(snap.settings);

  const keep = new Set(snap.streams.map((s) => s.id));
  let removed = 0;
  for (const s of current.streams) {
    if (!keep.has(s.id)) {
      await deleteStream(s.id);
      removed++;
    }
  }

  // The fingerprint now describes the restored state, so the next automatic
  // snapshot doesn't immediately re-save what we just wrote.
  localStorage.setItem(LAST_FP_KEY, fingerprint(buildSnapshot(snap.streams, snap.areas, snap.settings, new Date())));
  return { restored: snap.streams.length, removed };
}
