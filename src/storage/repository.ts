import { invoke } from "@tauri-apps/api/core";
import { mergeStreams } from "../core/merge";
import { Area, AreasFile } from "../models/area";
import { DEFAULT_SETTINGS, Settings } from "../models/settings";
import { Stream } from "../models/stream";

/**
 * The single place the store's location is decided.
 *
 * Resolved by Rust from a machine-local config, because this is the one setting
 * that can't live in settings.json (which lives inside the store) and must not
 * sync (each Mac has its own path to the same folder). Cached because it can't
 * change without a reload.
 */
let cachedRoot: string | null = null;

export async function storeRoot(): Promise<string> {
  if (cachedRoot === null) cachedRoot = await invoke<string>("get_store_root");
  return cachedRoot;
}

/** Point the store at a new folder. Returns the resolved root. */
export async function setStoreRoot(root: string | null): Promise<string> {
  cachedRoot = await invoke<string>("set_store_root", { root });
  return cachedRoot;
}

export type InvalidFile = { name: string; error: string };

export type LoadResult = {
  streams: Stream[];
  areas: Area[];
  settings: Settings;
  /**
   * Files that exist but did not parse. Surfaced, never swallowed: a store that
   * silently drops a stream is the failure this app exists to prevent (SPEC §8).
   */
  invalid: InvalidFile[];
};

type RawFile = { name: string; contents: string };

function describe(e: unknown): string {
  if (e && typeof e === "object" && "issues" in e) {
    const issues = (e as { issues: { path: (string | number)[]; message: string }[] }).issues;
    return issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  }
  return e instanceof Error ? e.message : String(e);
}

type ConflictFile = { filename: string; id: string; contents: string };

/**
 * Resolve whatever the sync daemon left behind (SPEC §6).
 *
 * Runs before anything is shown, so the app never renders a half-merged store.
 * The order is deliberate: **merge, write, verify, only then delete.** If the
 * write fails, the conflicted copy stays on disk and we try again next launch —
 * a duplicate file is a nuisance, a deleted one is gone.
 */
async function resolveConflicts(
  root: string,
  streams: Map<string, Stream>,
  invalid: InvalidFile[],
): Promise<number> {
  const conflicts = await invoke<ConflictFile[]>("read_conflicts", { root });
  let merged = 0;

  for (const c of conflicts) {
    let theirs: Stream;
    try {
      theirs = Stream.parse(JSON.parse(c.contents));
    } catch (e) {
      // Unreadable conflicted copy: leave the file alone and say so. Deleting
      // it would destroy the only surviving record of that edit.
      invalid.push({ name: c.filename, error: describe(e) });
      continue;
    }

    const ours = streams.get(c.id);
    try {
      const result = ours ? mergeStreams(ours, theirs, new Date()).stream : theirs;
      await saveStreamNow(result);
      streams.set(result.id, result);
      await invoke("delete_conflict", { root, filename: c.filename });
      merged++;
    } catch (e) {
      invalid.push({ name: c.filename, error: `merge failed: ${describe(e)}` });
    }
  }

  return merged;
}

export async function loadAll(): Promise<LoadResult> {
  const root = await storeRoot();
  await invoke("init_store", { root });

  const files = await invoke<RawFile[]>("read_all_streams", { root });
  const byId = new Map<string, Stream>();
  const invalid: InvalidFile[] = [];

  for (const f of files) {
    try {
      const s = Stream.parse(JSON.parse(f.contents));
      byId.set(s.id, s);
    } catch (e) {
      invalid.push({ name: f.name, error: describe(e) });
    }
  }

  await resolveConflicts(root, byId, invalid);
  const streams = [...byId.values()];

  let areas: Area[] = [];
  const areasRaw = await invoke<string | null>("read_root_file", {
    root,
    name: "areas.json",
  });
  if (areasRaw !== null) {
    try {
      areas = AreasFile.parse(JSON.parse(areasRaw)).areas;
    } catch (e) {
      invalid.push({ name: "areas.json", error: describe(e) });
    }
  }

  let settings = DEFAULT_SETTINGS;
  const settingsRaw = await invoke<string | null>("read_root_file", {
    root,
    name: "settings.json",
  });
  if (settingsRaw !== null) {
    try {
      settings = Settings.parse(JSON.parse(settingsRaw));
    } catch (e) {
      // Fall back to defaults rather than refuse to boot. Unlike a stream, a
      // broken settings file costs a preference, not data -- but say so.
      invalid.push({ name: "settings.json", error: describe(e) });
    }
  }

  return { streams, areas, settings, invalid };
}

export async function saveSettingsNow(settings: Settings): Promise<void> {
  await invoke("write_root_file", {
    root: await storeRoot(),
    name: "settings.json",
    contents: JSON.stringify(Settings.parse(settings), null, 2),
  });
}

export async function saveStreamNow(stream: Stream): Promise<void> {
  const root = await storeRoot();
  // Validate before writing. A rejected write is recoverable; a written-but-
  // invalid file would fail to load later, which looks like data loss.
  const valid = Stream.parse(stream);
  await invoke("write_stream", {
    root,
    id: valid.id,
    contents: JSON.stringify(valid, null, 2),
  });
}

export async function deleteStream(id: string): Promise<void> {
  await invoke("delete_stream", { root: await storeRoot(), id });
}

export async function saveAreasNow(areas: Area[]): Promise<void> {
  const root = await storeRoot();
  const file: AreasFile = { schemaVersion: 1, areas };
  await invoke("write_root_file", {
    root,
    name: "areas.json",
    contents: JSON.stringify(AreasFile.parse(file), null, 2),
  });
}

/**
 * Debounced, keyed by stream id.
 *
 * Keyed rather than global so a burst of typing on one stream rewrites only
 * that stream's file -- keeping the sync daemon's diff to one small file per
 * edit (SPEC §6, "Write on change, debounced").
 */
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Map<string, Stream>();

export function saveStream(stream: Stream, delayMs = 400): void {
  inflight.set(stream.id, stream);
  const existing = pending.get(stream.id);
  if (existing) clearTimeout(existing);

  pending.set(
    stream.id,
    setTimeout(() => {
      pending.delete(stream.id);
      const latest = inflight.get(stream.id);
      inflight.delete(stream.id);
      if (latest) void saveStreamNow(latest).catch((e) => console.error("save failed", e));
    }, delayMs),
  );
}

/** Flush every debounced write immediately. Call before quitting. */
export async function flushPending(): Promise<void> {
  const writes: Promise<void>[] = [];
  for (const [id, timer] of pending) {
    clearTimeout(timer);
    const latest = inflight.get(id);
    if (latest) writes.push(saveStreamNow(latest));
  }
  pending.clear();
  inflight.clear();
  await Promise.all(writes);
}
