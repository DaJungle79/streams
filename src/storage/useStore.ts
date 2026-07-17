import { useCallback, useEffect, useState } from "react";
import { addDays, toDay } from "../core/days";
import { structuralEvents } from "../core/events";
import { withState } from "../core/transitions";
import { Area, newArea } from "../models/area";
import { DEFAULT_SETTINGS, Settings } from "../models/settings";
import { LogEntryKind, newLogEntry } from "../models/logEntry";
import { Stream, touch } from "../models/stream";
import {
  InvalidFile,
  deleteStream as deleteStreamFile,
  flushPending,
  loadAll,
  saveAreasNow,
  saveSettingsNow,
  saveStream,
  saveStreamNow,
} from "./repository";

/** Seeded on first run so the app is never a blank wall with no area to file into. */
const STARTER_AREAS: [string, string][] = [
  ["Personal", "#6b7fd7"],
  ["Ideas", "#d78b6b"],
];

export type Store = {
  loading: boolean;
  error: string | null;
  invalid: InvalidFile[];
  streams: Stream[];
  areas: Area[];
  settings: Settings;
  createStream: (title: string, areaId: string) => Promise<Stream>;
  /** Applies an edit, stamps lastTouched, persists (debounced). */
  updateStream: (id: string, edit: (s: Stream) => Stream) => void;
  removeStream: (id: string) => Promise<void>;
  appendLog: (id: string, kind: LogEntryKind, text: string) => void;
  createArea: (name: string, color: string) => Promise<void>;
  completeStep: (id: string) => void;
  checkIn: (id: string) => void;
  snooze: (id: string, days: number) => void;
  nudge: (id: string) => void;
  reactivate: (id: string) => void;
  startReview: () => Promise<void>;
  finishReview: () => Promise<void>;
};

export function useStore(): Store {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<InvalidFile[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await loadAll();
        if (cancelled) return;

        let seeded = res.areas;
        if (seeded.length === 0) {
          seeded = STARTER_AREAS.map(([n, c]) => newArea(n, c));
          await saveAreasNow(seeded);
        }
        setStreams(res.streams);
        setAreas(seeded);
        setSettings(res.settings);
        setInvalid(res.invalid);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced writes are in flight when the window closes; flush them or the
  // last few keystrokes are lost.
  useEffect(() => {
    const onHide = () => void flushPending();
    window.addEventListener("beforeunload", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  /**
   * The single write path. Applies the edit, appends any structural log entries
   * the change implies (§3.3), stamps lastTouched, and persists.
   *
   * Everything mutating goes through here so the log can't depend on which
   * screen made the change.
   */
  const updateStream = useCallback((id: string, edit: (s: Stream) => Stream) => {
    setStreams((prev) => {
      const now = new Date();
      const next = prev.map((s) => {
        if (s.id !== id) return s;
        const edited = edit(s);
        const events = structuralEvents(s, edited, now);
        return touch(events.length ? { ...edited, log: [...events, ...edited.log] } : edited, now);
      });
      const changed = next.find((s) => s.id === id);
      if (changed) saveStream(changed);
      return next;
    });
  }, []);

  const appendLog = useCallback(
    (id: string, kind: LogEntryKind, text: string) => {
      updateStream(id, (s) => ({
        ...s,
        log: [newLogEntry(kind, text, new Date()), ...s.log],
      }));
    },
    [updateStream],
  );

  /**
   * SPEC §2: "mark step done → prompt for new step".
   *
   * The replacement is not prompted here -- clearing the step drops the stream
   * straight into §2.1 ("No next step"), which *is* the prompt, and one that
   * survives you closing the dialog. A modal you can dismiss would let the
   * stream go quiet, which is the one thing the app exists to prevent.
   */
  const completeStep = useCallback(
    (id: string) => {
      // No bespoke entry here: clearing the step makes structuralEvents log
      // "step-completed" itself. Adding one too would double-log.
      updateStream(id, (s) => (s.nextStep ? { ...s, nextStep: null } : s));
    },
    [updateStream],
  );

  /** §3.2: an explicit check-in. `touch()` in updateStream does the real work. */
  const checkIn = useCallback(
    (id: string) => {
      updateStream(id, (s) => ({
        ...s,
        log: [newLogEntry("checked-in", "checked in", new Date()), ...s.log],
      }));
    },
    [updateStream],
  );

  /** §2 row action: push a woken stream back to sleep for N more days. */
  const snooze = useCallback(
    (id: string, days: number) => {
      updateStream(id, (s) => {
        const until = addDays(toDay(new Date()), days);
        return {
          ...s,
          state: "parked",
          wakeUpDate: until,
          waitingSince: null,
          log: [newLogEntry("state-changed", `snoozed until ${until}`, new Date()), ...s.log],
        };
      });
    },
    [updateStream],
  );

  /**
   * §3.1: "'Nudge sent' action stamps the log and resets the waiting timer."
   *
   * Resetting `waitingSince` is the point: you've done your part, so the §2.4
   * clock restarts from the nudge rather than continuing to shout about a wait
   * you've already acted on. The log keeps the real history.
   */
  const nudge = useCallback(
    (id: string) => {
      updateStream(id, (s) => {
        const who = s.nextStep?.owner.kind === "person" ? s.nextStep.owner.name : "someone";
        return {
          ...s,
          waitingSince: toDay(new Date()),
          log: [newLogEntry("nudge-sent", `nudged ${who}`, new Date()), ...s.log],
        };
      });
    },
    [updateStream],
  );

  /** §5.2: streams can be reactivated from the archive. */
  const reactivate = useCallback(
    (id: string) => {
      updateStream(id, (s) => withState(s, "active", new Date()));
    },
    [updateStream],
  );

  const createStream = useCallback(async (title: string, areaId: string) => {
    const { newStream } = await import("../models/stream");
    const s = newStream(title, areaId, new Date());
    setStreams((prev) => [...prev, s]);
    await saveStreamNow(s);
    return s;
  }, []);

  const removeStream = useCallback(async (id: string) => {
    setStreams((prev) => prev.filter((s) => s.id !== id));
    await deleteStreamFile(id);
  }, []);

  /** §3.4: begin a pass. The timestamp is the whole of the resumable state. */
  const startReview = useCallback(async () => {
    const next: Settings = { ...settings, activeReviewStartedAt: new Date().toISOString() };
    setSettings(next);
    await saveSettingsNow(next);
  }, [settings]);

  /**
   * End a pass, whether completed or abandoned.
   *
   * `lastReviewAt` is stamped either way: §3.4's weekly nudge is about "when did
   * you last sit down with these", and a half-finished pass still counted. The
   * streams you skipped are still overdue on their own cadence, so nothing gets
   * away with it.
   */
  const finishReview = useCallback(async () => {
    const now = new Date().toISOString();
    const next: Settings = { ...settings, activeReviewStartedAt: null, lastReviewAt: now };
    setSettings(next);
    await saveSettingsNow(next);
  }, [settings]);

  const createArea = useCallback(
    async (name: string, color: string) => {
      const next = [...areas, newArea(name, color)];
      setAreas(next);
      await saveAreasNow(next);
    },
    [areas],
  );

  return {
    loading,
    error,
    invalid,
    streams,
    areas,
    settings,
    createStream,
    updateStream,
    removeStream,
    appendLog,
    createArea,
    completeStep,
    checkIn,
    snooze,
    nudge,
    reactivate,
    startReview,
    finishReview,
  };
}
