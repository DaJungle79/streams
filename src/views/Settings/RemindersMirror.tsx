import { useEffect, useState } from "react";
import { mirrorSet } from "../../core/mirrorSet";
import { Area } from "../../models/area";
import { Stream } from "../../models/stream";
import { mirrorEnabled, setMirrorEnabled, tearDown } from "../../services/remindersMirror";

type Props = { streams: Stream[]; areas: Area[] };

/**
 * The §4.5 toggle.
 *
 * Machine-local and default-off, because Reminders syncs itself via iCloud: a
 * second mirroring Mac makes duplicates, not redundancy. The copy says so
 * rather than leaving you to discover it.
 */
export function RemindersMirror({ streams, areas }: Props) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void mirrorEnabled().then(setOn);
  }, []);

  const count = mirrorSet(streams, areas).length;

  const toggle = async () => {
    setBusy(true);
    try {
      if (on) {
        // Switching off removes what we created. Leaving orphans behind would
        // mean a Reminders list that quietly stops tracking reality -- worse
        // than no list, because it still looks authoritative.
        await tearDown();
        await setMirrorEnabled(false);
        setOn(false);
      } else {
        await setMirrorEnabled(true);
        setOn(true);
      }
    } finally {
      setBusy(false);
    }
  };

  if (on === null) return null;

  return (
    <>
      <div className="set-row">
        <div className="set-label">
          <span>Mirror to Apple Reminders</span>
          <span className="muted set-hint">
            Pushes your own next steps to a dedicated <strong>Streams</strong> list, so your phone
            can see what's next. One-way: ticking a reminder there does nothing here.
          </span>
        </div>
        <button className={`chip ${on ? "is-on" : ""}`} disabled={busy} onClick={() => void toggle()}>
          {busy ? "…" : on ? "On" : "Off"}
        </button>
      </div>

      {on && (
        <p className="muted set-hint set-note">
          Mirroring {count} step{count === 1 ? "" : "s"} from this Mac.
          <br />
          Turn this on from <strong>one Mac only</strong> — Reminders already syncs via iCloud, so a
          second one would duplicate every reminder rather than help.
        </p>
      )}
    </>
  );
}
