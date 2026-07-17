import { useMemo, useState } from "react";
import { toDay, withState } from "../../core/transitions";
import { reviewProgress, reviewQueue } from "../../core/review";
import { Area } from "../../models/area";
import { Stream, StreamState } from "../../models/stream";

type Props = {
  streams: Stream[];
  areas: Area[];
  startedAt: string;
  knownPeople: string[];
  onUpdate: (id: string, edit: (s: Stream) => Stream) => void;
  onFinish: () => void;
  onOpen: (id: string) => void;
};

/**
 * The guided pass (SPEC §3.4): still relevant? → is the next step right? → is
 * the owner right?
 *
 * Full-screen and one stream at a time, on purpose. The point isn't to edit
 * efficiently — the list does that — it's to force a decision per stream
 * without the others in peripheral vision.
 */
export function ReviewView({
  streams,
  areas,
  startedAt,
  knownPeople,
  onUpdate,
  onFinish,
  onOpen,
}: Props) {
  // Skipping is a session-local decision: it means "not now", not "reviewed".
  // Persisting it would quietly let a stream dodge a whole pass, which is
  // exactly the silence §3.4 exists to break.
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const queue = useMemo(
    () => reviewQueue(streams, startedAt).filter((s) => !skipped.has(s.id)),
    [streams, startedAt, skipped],
  );
  const progress = reviewProgress(streams, startedAt);
  const current = queue[0];

  if (!current) {
    const done = progress.reviewed;
    return (
      <div className="attention-empty">
        <p className="attention-empty-title">Review complete.</p>
        <p className="muted">
          {done} stream{done === 1 ? "" : "s"} reviewed
          {skipped.size > 0 && `, ${skipped.size} skipped`}.
        </p>
        <button className="chip review-finish" onClick={onFinish}>
          Done
        </button>
      </div>
    );
  }

  const set = (edit: (s: Stream) => Stream) => onUpdate(current.id, edit);
  const area = areas.find((a) => a.id === current.areaId);

  // Any touch counts as the check-in (§3.2), so "keep" just needs to touch.
  const keep = () => set((s) => ({ ...s }));

  return (
    <div className="review">
      <header className="review-head">
        <span className="muted">
          {progress.reviewed + 1} of {progress.total}
        </span>
        <div className="review-bar">
          <span style={{ width: `${(progress.reviewed / Math.max(1, progress.total)) * 100}%` }} />
        </div>
        <button className="chip" onClick={onFinish}>
          Finish later
        </button>
      </header>

      <div className="review-card">
        <h1 className="review-title">
          {current.priority === "high" && <span className="pin">▲</span>}
          {current.title}
          {area && <span className="att-area">{area.name}</span>}
        </h1>
        {current.outcome ? (
          <p className="review-outcome">{current.outcome}</p>
        ) : (
          <p className="review-outcome muted">no outcome recorded</p>
        )}
        <p className="muted review-touched">
          last touched {new Date(current.lastTouched).toLocaleDateString()} · {current.state}
        </p>

        <section className="review-q">
          <h2>Still relevant?</h2>
          <div className="row wrap">
            <button className="chip is-on" onClick={keep}>
              Keep
            </button>
            {(["parked", "done"] as StreamState[]).map((st) => (
              <button key={st} className="chip" onClick={() => set((s) => withState(s, st, new Date()))}>
                {st === "parked" ? "Park" : "Done"}
              </button>
            ))}
          </div>
        </section>

        <section className="review-q">
          <h2>Is the next step right?</h2>
          <input
            className="review-input"
            placeholder="What happens next?"
            value={current.nextStep?.text ?? ""}
            onChange={(e) =>
              set((s) => {
                const text = e.target.value;
                if (!text) return { ...s, nextStep: null };
                return {
                  ...s,
                  nextStep: s.nextStep
                    ? { ...s.nextStep, text }
                    : { text, owner: { kind: "me" }, setAt: toDay(new Date()) },
                };
              })
            }
          />
          {current.nextStep && (
            <p className="muted review-hint">set {current.nextStep.setAt}</p>
          )}
        </section>

        <section className="review-q">
          <h2>Is the owner right?</h2>
          <div className="row wrap">
            <button
              className={`chip ${current.nextStep?.owner.kind === "me" ? "is-on" : ""}`}
              disabled={!current.nextStep}
              onClick={() =>
                set((s) => (s.nextStep ? { ...s, nextStep: { ...s.nextStep, owner: { kind: "me" } } } : s))
              }
            >
              me
            </button>
            <input
              list="known-people"
              className="review-owner"
              placeholder="…or a person"
              disabled={!current.nextStep}
              value={current.nextStep?.owner.kind === "person" ? current.nextStep.owner.name : ""}
              onChange={(e) =>
                set((s) => {
                  if (!s.nextStep) return s;
                  const name = e.target.value;
                  return {
                    ...s,
                    nextStep: { ...s.nextStep, owner: name ? { kind: "person", name } : { kind: "me" } },
                  };
                })
              }
            />
            <datalist id="known-people">
              {knownPeople.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
          {!current.nextStep && <p className="muted review-hint">set a next step first</p>}
        </section>

        <footer className="review-foot">
          <button className="chip" onClick={() => setSkipped((p) => new Set(p).add(current.id))}>
            Skip
          </button>
          <button className="chip" onClick={() => onOpen(current.id)}>
            Open full stream
          </button>
          {/* Touching the stream is what advances the queue, so "Next" is just
              a keep — the same action, named for where you are. */}
          <button className="chip is-on" onClick={keep}>
            Next →
          </button>
        </footer>
      </div>
    </div>
  );
}
