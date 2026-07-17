import { useState } from "react";
import { Area } from "../../models/area";
import { Stream, StreamState } from "../../models/stream";

type Props = {
  streams: Stream[];
  areas: Area[];
  selectedAreaId: string | null;
  selectedStreamId: string | null;
  onSelectStream: (id: string) => void;
  onCreateStream: (title: string) => void;
};

const STATE_ORDER: Record<StreamState, number> = {
  active: 0,
  waiting: 1,
  parked: 2,
  done: 3,
};

export function StreamList({
  streams,
  areas,
  selectedAreaId,
  selectedStreamId,
  onSelectStream,
  onCreateStream,
}: Props) {
  const [title, setTitle] = useState("");
  const areaById = new Map(areas.map((a) => [a.id, a]));

  const visible = streams
    .filter((s) => selectedAreaId === null || s.areaId === selectedAreaId)
    .sort((a, b) => {
      // High priority pins to the top of every view (SPEC §5.3).
      if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
      if (a.state !== b.state) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
      return a.title.localeCompare(b.title);
    });

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onCreateStream(trimmed);
    setTitle("");
  };

  const canCreate = selectedAreaId !== null || areas.length > 0;

  return (
    <div className="list">
      <div className="list-new">
        <input
          className="list-new-input"
          value={title}
          placeholder={canCreate ? "New stream…" : "Create an area first"}
          disabled={!canCreate}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </div>

      {visible.length === 0 ? (
        <p className="empty">No streams here yet.</p>
      ) : (
        <ul className="list-items">
          {visible.map((s) => {
            const area = areaById.get(s.areaId);
            return (
              <li key={s.id}>
                <button
                  className={`stream-row ${selectedStreamId === s.id ? "is-selected" : ""} ${
                    s.state === "done" ? "is-done" : ""
                  }`}
                  onClick={() => onSelectStream(s.id)}
                >
                  <span
                    className="stream-accent"
                    style={{ background: area?.color ?? "transparent" }}
                  />
                  <span className="stream-main">
                    <span className="stream-title">
                      {s.priority === "high" && <span className="pin" title="High priority">▲</span>}
                      {s.title}
                    </span>
                    <span className="stream-sub">
                      {/* The one question the product answers, on every row. */}
                      {s.nextStep
                        ? `${s.nextStep.text} · ${
                            s.nextStep.owner.kind === "me" ? "me" : s.nextStep.owner.name
                          }`
                        : "no next step"}
                    </span>
                  </span>
                  <span className={`state-chip state-${s.state}`}>{s.state}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
