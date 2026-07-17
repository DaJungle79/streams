import { useState } from "react";
import { Area } from "../../models/area";
import { Stream } from "../../models/stream";
import type { Screen } from "../../App";

const PALETTE = ["#6b7fd7", "#d78b6b", "#6bd79b", "#d76b9b", "#b06bd7", "#d7c76b"];

type Props = {
  areas: Area[];
  streams: Stream[];
  selectedAreaId: string | null;
  onSelectArea: (id: string | null) => void;
  onCreateArea: (name: string, color: string) => void;
  screen: Screen;
  onGoTo: (s: Screen) => void;
  attentionCount: number;
  waitingCount: number;
};

export function Sidebar({
  areas,
  streams,
  selectedAreaId,
  onSelectArea,
  onCreateArea,
  screen,
  onGoTo,
  attentionCount,
  waitingCount,
}: Props) {
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
      <button className={`att-nav ${screen === "attention" ? "is-selected" : ""}`} onClick={() => onGoTo("attention")}>
        <span className="area-name">Attention</span>
        {/* No zero badge: "nothing needs you" is the AttentionView's line to
            deliver, and a grey 0 here would undercut it. */}
        {attentionCount > 0 && <span className="att-badge">{attentionCount}</span>}
      </button>

      <button className={`att-nav att-nav-sub ${screen === "waiting" ? "is-selected" : ""}`} onClick={() => onGoTo("waiting")}>
        <span className="area-name">Waiting</span>
        {waitingCount > 0 && <span className="area-count">{waitingCount}</span>}
      </button>

      <button className={`att-nav att-nav-sub ${screen === "review" ? "is-selected" : ""}`} onClick={() => onGoTo("review")}>
        <span className="area-name">Review</span>
      </button>

      <button className={`att-nav att-nav-sub ${screen === "archive" ? "is-selected" : ""}`} onClick={() => onGoTo("archive")}>
        <span className="area-name">Archive</span>
      </button>

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
