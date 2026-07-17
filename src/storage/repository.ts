import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { Area, AreasFile } from "../models/area";
import { DEFAULT_SETTINGS, Settings } from "../models/settings";
import { Stream } from "../models/stream";

/**
 * The single place the store's location is decided.
 *
 * M1 keeps it in the app-data dir. M6 points it at the user's sync folder --
 * and because nothing else in the codebase knows where the store lives, that
 * milestone is this one function plus merge logic (PLAN, "Order rationale").
 */
export async function storeRoot(): Promise<string> {
  return join(await appDataDir(), "Streams");
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

export async function loadAll(): Promise<LoadResult> {
  const root = await storeRoot();
  await invoke("init_store", { root });

  const files = await invoke<RawFile[]>("read_all_streams", { root });
  const streams: Stream[] = [];
  const invalid: InvalidFile[] = [];

  for (const f of files) {
    try {
      streams.push(Stream.parse(JSON.parse(f.contents)));
    } catch (e) {
      invalid.push({ name: f.name, error: describe(e) });
    }
  }

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
