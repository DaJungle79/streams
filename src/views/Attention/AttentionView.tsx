import { AttentionItem, AttentionOptions, attentionGroups } from "../../core/attentionEngine";
import { toDay } from "../../core/days";
import { Area } from "../../models/area";
import { Stream } from "../../models/stream";

type Props = {
  streams: Stream[];
  areas: Area[];
  now: Date;
  opts: AttentionOptions;
  onOpen: (id: string) => void;
  onCompleteStep: (id: string) => void;
  onCheckIn: (id: string) => void;
  onSnooze: (id: string, days: number) => void;
};

export function AttentionView({
  streams,
  areas,
  now,
  opts,
  onOpen,
  onCompleteStep,
  onCheckIn,
  onSnooze,
}: Props) {
  const groups = attentionGroups(streams, now, opts);
  const areaById = new Map(areas.map((a) => [a.id, a]));

  // SPEC §2: "When the view is empty, it says so — an explicit 'nothing needs
  // you' state is the reward." Not a blank screen.
  if (groups.length === 0) {
    return (
      <div className="attention-empty">
        <p className="attention-empty-title">Nothing needs you.</p>
        <p className="muted">
          {streams.filter((s) => s.state !== "done").length} live stream
          {streams.filter((s) => s.state !== "done").length === 1 ? "" : "s"}, all covered.
        </p>
      </div>
    );
  }

  const row = (item: AttentionItem) => {
    const s = item.stream;
    const area = areaById.get(s.areaId);
    return (
      <li key={s.id} className="att-row">
        <span className="stream-accent" style={{ background: area?.color ?? "transparent" }} />

        <span className="att-main">
          <span className="att-title">
            {s.priority === "high" && <span className="pin" title="High priority">▲</span>}
            {s.title}
            {area && <span className="att-area">{area.name}</span>}
          </span>

          {/* Why it's here — the reason, in the user's own terms. */}
          <span className="att-reason">{item.detail}</span>

          <span className="att-step">
            {s.nextStep ? (
              <>
                {s.nextStep.text}
                <span className="muted">
                  {" · "}
                  {s.nextStep.owner.kind === "me" ? "me" : s.nextStep.owner.name}
                </span>
              </>
            ) : (
              <span className="muted">— no next step —</span>
            )}
          </span>
        </span>

        <span className="att-actions">
          {s.nextStep && (
            <button className="chip" onClick={() => onCompleteStep(s.id)} title="Mark done, then set the next one">
              Step done
            </button>
          )}
          {item.reason === "check-in-overdue" && (
            <button className="chip" onClick={() => onCheckIn(s.id)}>
              Checked in
            </button>
          )}
          {item.reason === "waking-up" && (
            <button className="chip" onClick={() => onSnooze(s.id, 7)}>
              Snooze 7d
            </button>
          )}
          <button className="chip" onClick={() => onOpen(s.id)}>
            Open
          </button>
        </span>
      </li>
    );
  };

  return (
    <div className="attention">
      <header className="att-header">
        <h1>What needs you</h1>
        <span className="muted">{toDay(now)}</span>
      </header>

      {groups.map((g) => (
        <section key={g.reason} className="att-group">
          <h2 className="att-group-title">
            {g.title}
            <span className="att-group-count">{g.items.length}</span>
          </h2>
          <ul className="att-list">{g.items.map(row)}</ul>
        </section>
      ))}
    </div>
  );
}
