import { useState } from "react";
import { Area } from "../../models/area";
import { Stream } from "../../models/stream";

const PALETTE = ["#6b7fd7", "#d78b6b", "#6bd79b", "#d76b9b", "#b06bd7", "#d7c76b"];

type Props = {
  areas: Area[];
  streams: Stream[];
  selectedAreaId: string | null;
  onSelectArea: (id: string | null) => void;
  onCreateArea: (name: string, color: string) => void;
};

export function Sidebar({ areas, streams, selectedAreaId, onSelectArea, onCreateArea }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  // "done" streams live in the Archive (§5.2), so they don't inflate these counts.
  const liveCount = (areaId: string | null) =>
    streams.filter((s) => s.state !== "done" && (areaId === null || s.areaId === areaId)).length;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreateArea(trimmed, PALETTE[areas.length % PALETTE.length]);
    setName("");
    setAdding(false);
  };

  return (
    <nav className="sidebar">
      <div className="sidebar-section">Areas</div>

      <button
        className={`area-row ${selectedAreaId === null ? "is-selected" : ""}`}
        onClick={() => onSelectArea(null)}
      >
        <span className="area-dot" style={{ background: "transparent", borderColor: "currentColor" }} />
        <span className="area-name">All</span>
        <span className="area-count">{liveCount(null)}</span>
      </button>

      {areas.map((a) => (
        <button
          key={a.id}
          className={`area-row ${selectedAreaId === a.id ? "is-selected" : ""}`}
          onClick={() => onSelectArea(a.id)}
        >
          <span className="area-dot" style={{ background: a.color, borderColor: a.color }} />
          <span className="area-name">{a.name}</span>
          <span className="area-count">{liveCount(a.id)}</span>
        </button>
      ))}

      {adding ? (
        <input
          autoFocus
          className="area-input"
          value={name}
          placeholder="Area name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") {
              setName("");
              setAdding(false);
            }
          }}
          onBlur={submit}
        />
      ) : (
        <button className="area-add" onClick={() => setAdding(true)}>
          + Add area
        </button>
      )}
    </nav>
  );
}
