import { useCallback, useEffect, useState } from "react";
import { Area } from "../../models/area";
import { Settings } from "../../models/settings";
import { Stream } from "../../models/stream";
import {
  BackupFile,
  backupDir,
  backupIfChanged,
  lastBackupAt,
  listBackups,
  readSnapshot,
  restoreSnapshot,
} from "../../services/backup";

type Props = { streams: Stream[]; areas: Area[]; settings: Settings };

const ago = (d: Date) => {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

export function Backups({ streams, areas, settings }: Props) {
  const [dir, setDir] = useState<string | null | undefined>(undefined);
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const d = await backupDir();
    setDir(d);
    if (d) setFiles(await listBackups(d));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (dir === undefined) return null;

  if (dir === null) {
    return (
      <p className="muted set-hint">
        iCloud Drive isn't set up on this Mac, so there's nowhere to put snapshots. Your streams
        exist on this disk only.
      </p>
    );
  }

  const backupNow = async () => {
    setBusy(true);
    const r = await backupIfChanged(streams, areas, settings, { force: true });
    setNote(r.status === "written" ? `Saved ${r.filename}` : r.status === "error" ? r.error : r.status);
    await refresh();
    setBusy(false);
  };

  const restore = async (filename: string) => {
    setBusy(true);
    try {
      const snap = await readSnapshot(dir, filename);
      const r = await restoreSnapshot(snap, { streams, areas, settings });
      setNote(`Restored ${r.restored} stream${r.restored === 1 ? "" : "s"}${r.removed ? `, removed ${r.removed}` : ""}`);
      // The store is read once at boot and held in memory, so the only honest
      // way to show a restored store is to reload.
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      setNote(`Restore failed: ${String(e)}`);
      setBusy(false);
    }
    setConfirming(null);
  };

  const last = lastBackupAt();

  return (
    <>
      <div className="set-row">
        <div className="set-label">
          <span>Automatic snapshots</span>
          <span className="muted set-hint">
            The whole store, one file, into iCloud Drive — written only when something actually
            changed. One-way: nothing is ever loaded back without you asking.
          </span>
        </div>
        <button className="chip" disabled={busy} onClick={() => void backupNow()}>
          {busy ? "…" : "Back up now"}
        </button>
      </div>

      <p className="muted set-hint set-note">
        {last ? `Last snapshot ${ago(last)}.` : "No snapshot yet."} {files.length} kept in{" "}
        <code>{dir.replace(/^\/Users\/[^/]+/, "~")}</code>
        <br />
        Snapshots are a parachute, not sync — restoring is manual, and it replaces everything.
      </p>

      {files.length > 0 && (
        <ul className="backup-list">
          {files.slice(0, 8).map((f) => (
            <li key={f.filename}>
              <span className="backup-when">
                {new Date(f.modified * 1000).toLocaleString()}
                <span className="muted"> · {(f.bytes / 1024).toFixed(0)} KB</span>
              </span>
              {confirming === f.filename ? (
                <span className="row">
                  <span className="muted">Replace everything?</span>
                  <button className="danger" disabled={busy} onClick={() => void restore(f.filename)}>
                    Yes, restore
                  </button>
                  <button className="chip" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button className="chip" disabled={busy} onClick={() => setConfirming(f.filename)}>
                  Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {note && <p className="muted set-hint">{note}</p>}
    </>
  );
}
