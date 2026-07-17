import { waitingByPerson } from "../../core/waiting";
import { Area } from "../../models/area";
import { Stream } from "../../models/stream";

type Props = {
  streams: Stream[];
  areas: Area[];
  now: Date;
  waitingThresholdDays: number;
  onOpen: (id: string) => void;
  onNudge: (id: string) => void;
};

export function WaitingView({ streams, areas, now, waitingThresholdDays, onOpen, onNudge }: Props) {
  const people = waitingByPerson(streams, now);
  const areaById = new Map(areas.map((a) => [a.id, a]));

  if (people.length === 0) {
    return (
      <div className="attention-empty">
        <p className="attention-empty-title">Waiting on no one.</p>
        <p className="muted">Every open step is yours.</p>
      </div>
    );
  }

  return (
    <div className="attention">
      <header className="att-header">
        <h1>Waiting on</h1>
      </header>

      {people.map((p) => (
        <section key={p.name} className="att-group">
          <h2 className="att-group-title">
            {p.name}
            <span className="att-group-count">{p.entries.length}</span>
            {p.longestDays > waitingThresholdDays && (
              <span className="att-overdue">longest {p.longestDays}d</span>
            )}
          </h2>

          <ul className="att-list">
            {p.entries.map(({ stream, days }) => {
              const area = areaById.get(stream.areaId);
              return (
                <li key={stream.id} className="att-row">
                  <span className="stream-accent" style={{ background: area?.color ?? "transparent" }} />
                  <span className="att-main">
                    <span className="att-title">
                      {stream.priority === "high" && <span className="pin">▲</span>}
                      {stream.title}
                      {area && <span className="att-area">{area.name}</span>}
                    </span>
                    <span className={days > waitingThresholdDays ? "att-reason" : "muted"}>
                      waiting {days} day{days === 1 ? "" : "s"}
                    </span>
                    <span className="att-step">{stream.nextStep?.text}</span>
                  </span>
                  <span className="att-actions">
                    {/* §3.1: stamps the log and resets the waiting timer. */}
                    <button className="chip" onClick={() => onNudge(stream.id)} title="Stamps the log and restarts the clock">
                      Nudge sent
                    </button>
                    <button className="chip" onClick={() => onOpen(stream.id)}>
                      Open
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
