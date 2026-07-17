import { Area } from "../../models/area";
import { Stream } from "../../models/stream";

type Props = {
  streams: Stream[];
  areas: Area[];
  selectedAreaId: string | null;
  onOpen: (id: string) => void;
  onReactivate: (id: string) => void;
};

/**
 * Done streams, with their full logs (SPEC §5.2) — an outcomes history per area.
 * Nothing is deleted on completion; it moves out of the working views and stays
 * readable.
 */
export function ArchiveView({ streams, areas, selectedAreaId, onOpen, onReactivate }: Props) {
  const areaById = new Map(areas.map((a) => [a.id, a]));

  const done = streams
    .filter((s) => s.state === "done")
    .filter((s) => selectedAreaId === null || s.areaId === selectedAreaId)
    // Most recently finished first.
    .sort((a, b) => b.lastTouched.localeCompare(a.lastTouched));

  if (done.length === 0) {
    return (
      <div className="attention-empty">
        <p className="attention-empty-title">Archive is empty.</p>
        <p className="muted">Streams land here when you mark them done.</p>
      </div>
    );
  }

  return (
    <div className="attention">
      <header className="att-header">
        <h1>Archive</h1>
        <span className="muted">
          {done.length} outcome{done.length === 1 ? "" : "s"}
        </span>
      </header>

      <ul className="att-list">
        {done.map((s) => {
          const area = areaById.get(s.areaId);
          return (
            <li key={s.id} className="att-row">
              <span className="stream-accent" style={{ background: area?.color ?? "transparent" }} />
              <span className="att-main">
                <span className="att-title">
                  {s.title}
                  {area && <span className="att-area">{area.name}</span>}
                </span>
                {/* The outcome is the point of the archive — what did this drive to? */}
                <span className="muted">{s.outcome || "no outcome recorded"}</span>
                <span className="att-step muted">
                  {s.log.length} log entr{s.log.length === 1 ? "y" : "ies"} · finished{" "}
                  {new Date(s.lastTouched).toLocaleDateString()}
                </span>
              </span>
              <span className="att-actions">
                <button className="chip" onClick={() => onReactivate(s.id)}>
                  Reactivate
                </button>
                <button className="chip" onClick={() => onOpen(s.id)}>
                  Open
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
