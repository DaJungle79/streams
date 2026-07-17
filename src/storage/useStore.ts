import { useCallback, useEffect, useState } from "react";
import { addDays, toDay } from "../core/days";
import { Area, newArea } from "../models/area";
import { LogEntryKind, newLogEntry } from "../models/logEntry";
import { Stream, touch } from "../models/stream";
import {
  InvalidFile,
  deleteStream as deleteStreamFile,
  flushPending,
  loadAll,
  saveAreasNow,
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
  createStream: (title: string, areaId: string) => Promise<Stream>;
  /** Applies an edit, stamps lastTouched, persists (debounced). */
  updateStream: (id: string, edit: (s: Stream) => Stream) => void;
  removeStream: (id: string) => Promise<void>;
  appendLog: (id: string, kind: LogEntryKind, text: string) => void;
  createArea: (name: string, color: string) => Promise<void>;
  completeStep: (id: string) => void;
  checkIn: (id: string) => void;
  snooze: (id: string, days: number) => void;
};

export function useStore(): Store {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<InvalidFile[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);

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

  const updateStream = useCallback((id: string, edit: (s: Stream) => Stream) => {
    setStreams((prev) => {
      const next = prev.map((s) => (s.id === id ? touch(edit(s), new Date()) : s));
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
      updateStream(id, (s) => {
        if (!s.nextStep) return s;
        return {
          ...s,
          nextStep: null,
          log: [newLogEntry("step-completed", s.nextStep.text, new Date()), ...s.log],
        };
      });
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
    createStream,
    updateStream,
    removeStream,
    appendLog,
    createArea,
    completeStep,
    checkIn,
    snooze,
  };
}
