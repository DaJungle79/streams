import { invoke } from "@tauri-apps/api/core";
import { MirrorItem, ReminderMap, isPlanEmpty, mirrorSet, planMirror } from "../core/mirrorSet";
import { Area } from "../models/area";
import { Stream } from "../models/stream";

/**
 * Drives the Reminders mirror (SPEC §4.5).
 *
 * Decides *what to change* by diffing `mirrorSet` against the map; `reminders.rs`
 * does the shelling out. Nothing here knows any AppleScript.
 */

export async function mirrorEnabled(): Promise<boolean> {
  return invoke<boolean>("get_mirror_enabled");
}

export async function setMirrorEnabled(enabled: boolean): Promise<void> {
  await invoke("set_mirror_enabled", { enabled });
}

async function readMap(): Promise<ReminderMap> {
  try {
    return JSON.parse(await invoke<string>("read_reminder_map"));
  } catch {
    // A corrupt map is recoverable: an empty one just re-creates the reminders,
    // and the heal step below removes the orphans it left behind.
    return {};
  }
}

async function writeMap(map: ReminderMap): Promise<void> {
  await invoke("write_reminder_map", { contents: JSON.stringify(map, null, 2) });
}

export type MirrorReport = { created: number; updated: number; deleted: number; errors: string[] };

/**
 * Reconcile Reminders to match the mirror set.
 *
 * The map is written after **every** successful operation rather than once at
 * the end: if the app dies mid-reconcile, a map that already records what was
 * created is the difference between resuming and creating everything twice.
 */
export async function reconcile(streams: Stream[], areas: Area[]): Promise<MirrorReport> {
  const report: MirrorReport = { created: 0, updated: 0, deleted: 0, errors: [] };
  if (!(await mirrorEnabled())) return report;

  const desired = mirrorSet(streams, areas);
  let map = await readMap();
  map = await healMap(map, report);

  const plan = planMirror(desired, map);
  if (isPlanEmpty(plan)) return report;

  for (const item of plan.creates) {
    try {
      const reminderId = await invoke<string>("reminders_create", {
        title: item.title,
        notes: item.notes,
        due: item.dueDate,
      });
      map[item.streamId] = { reminderId, fingerprint: item.fingerprint };
      await writeMap(map);
      report.created++;
    } catch (e) {
      report.errors.push(`create "${item.title}": ${String(e)}`);
    }
  }

  for (const { item, reminderId } of plan.updates) {
    try {
      await invoke("reminders_update", {
        id: reminderId,
        title: item.title,
        notes: item.notes,
        due: item.dueDate,
      });
      map[item.streamId] = { reminderId, fingerprint: item.fingerprint };
      await writeMap(map);
      report.updated++;
    } catch (e) {
      // Most likely the reminder was deleted by hand. Drop the mapping so the
      // next pass re-creates it rather than retrying a dead id forever.
      delete map[item.streamId];
      await writeMap(map);
      report.errors.push(`update "${item.title}": ${String(e)}`);
    }
  }

  for (const { streamId, reminderId } of plan.deletes) {
    try {
      await invoke("reminders_delete", { id: reminderId });
      delete map[streamId];
      await writeMap(map);
      report.deleted++;
    } catch (e) {
      report.errors.push(`delete ${reminderId}: ${String(e)}`);
    }
  }

  return report;
}

/**
 * Drop map entries whose reminder no longer exists.
 *
 * Without this, deleting a mirrored reminder on your phone would leave the map
 * pointing at a ghost: we'd never re-create it (the map says it exists) and
 * never notice (updates would just fail). The stream would then be the one thing
 * the app promises can't happen — silently missing from a surface you rely on.
 */
async function healMap(map: ReminderMap, report: MirrorReport): Promise<ReminderMap> {
  let live: string[];
  try {
    live = await invoke<string[]>("reminders_list_ids");
  } catch (e) {
    // Can't see Reminders (no permission yet?). Leave the map alone rather than
    // conclude everything is gone and re-create the lot.
    report.errors.push(`list: ${String(e)}`);
    return map;
  }

  const alive = new Set(live);
  const healed: ReminderMap = {};
  let dropped = 0;
  for (const [streamId, entry] of Object.entries(map)) {
    if (alive.has(entry.reminderId)) healed[streamId] = entry;
    else dropped++;
  }
  if (dropped > 0) await writeMap(healed);
  return healed;
}

/** Remove every mirrored reminder and forget the map. Used when switching off. */
export async function tearDown(): Promise<number> {
  const map = await readMap();
  let removed = 0;
  for (const { reminderId } of Object.values(map)) {
    try {
      await invoke("reminders_delete", { id: reminderId });
      removed++;
    } catch {
      // Already gone is fine — the end state is what matters.
    }
  }
  await writeMap({});
  return removed;
}

export type { MirrorItem };
