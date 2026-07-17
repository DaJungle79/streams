import { useState } from "react";
import { parseFuzzyDate } from "../../core/fuzzyDateParser";
import { toDay, withState } from "../../core/transitions";
import { Area } from "../../models/area";
import { LogEntryKind } from "../../models/logEntry";
import { Stream, StreamState } from "../../models/stream";

type Props = {
  stream: Stream;
  areas: Area[];
  knownPeople: string[];
  onUpdate: (id: string, edit: (s: Stream) => Stream) => void;
  onAppendLog: (id: string, kind: LogEntryKind, text: string) => void;
  onDelete: (id: string) => void;
};

const STATES: StreamState[] = ["active", "waiting", "parked", "done"];

/** A date input needs "" for empty; the model needs null. */
const dayValue = (d: string | null) => d ?? "";
const dayOrNull = (v: string) => (v === "" ? null : v);

/**
 * One text field, parsed live (SPEC §1).
 *
 * The interpretation is shown inline for confirmation rather than applied
 * silently: the parser is guessing at intent, and a wrong guess that looks
 * confident is worse than no guess. When it can't parse, the manual pickers
 * below stay authoritative — a gap in the grammar is an inconvenience, never a
 * blocker.
 */
function DeadlineField({
  stream,
  set,
}: {
  stream: Stream;
  set: (edit: (s: Stream) => Stream) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? stream.targetDeadline?.label ?? "";
  const parsed = text.trim() ? parseFuzzyDate(text, new Date()) : null;

  const commit = (value: string) => {
    const label = value.trim();
    if (!label) {
      set((s) => ({ ...s, targetDeadline: null }));
      return;
    }
    const p = parseFuzzyDate(label, new Date());
    set((s) => ({
      ...s,
      targetDeadline: p
        ? p
        : // Unparseable: keep the user's words, and leave the window to the
          // manual pickers rather than inventing one.
          s.targetDeadline
          ? { ...s.targetDeadline, label }
          : { label, earliest: toDay(new Date()), latest: toDay(new Date()) },
    }));
  };

  return (
    <>
      <input
        placeholder='e.g. "end of Q3 2026", "late September", "2026-09-14"'
        value={text}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
        }}
        onBlur={() => setDraft(null)}
      />
      {text.trim() !== "" &&
        (parsed ? (
          <p className="parse-ok">
            {parsed.earliest === parsed.latest
              ? `→ ${parsed.earliest}`
              : `→ ${parsed.earliest} to ${parsed.latest}`}
          </p>
        ) : (
          <p className="parse-miss">
            → couldn't read that — set the window by hand below
          </p>
        ))}
    </>
  );
}

export function StreamDetail({ stream, areas, knownPeople, onUpdate, onAppendLog, onDelete }: Props) {
  const [note, setNote] = useState("");
  const set = (edit: (s: Stream) => Stream) => onUpdate(stream.id, edit);

  const addNote = () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    onAppendLog(stream.id, "manual", trimmed);
    setNote("");
  };

  const deadline = stream.targetDeadline;

  return (
    <div className="detail">
      <input
        className="detail-title"
        value={stream.title}
        onChange={(e) => set((s) => ({ ...s, title: e.target.value || s.title }))}
      />

      <div className="grid">
        <label>Area</label>
        <select
          value={stream.areaId}
          onChange={(e) => set((s) => ({ ...s, areaId: e.target.value }))}
        >
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <label>State</label>
        <div className="row">
          {STATES.map((st) => (
            <button
              key={st}
              className={`chip ${stream.state === st ? "is-on" : ""}`}
              // Always via withState: it supplies the wake-up / waiting-since
              // fields the schema demands, so the result is saveable.
              onClick={() => set((s) => withState(s, st, new Date()))}
            >
              {st}
            </button>
          ))}
        </div>

        <label>Priority</label>
        <div className="row">
          {(["normal", "high"] as const).map((p) => (
            <button
              key={p}
              className={`chip ${stream.priority === p ? "is-on" : ""}`}
              onClick={() => set((s) => ({ ...s, priority: p }))}
            >
              {p}
            </button>
          ))}
        </div>

        <label>Outcome</label>
        <textarea
          rows={2}
          placeholder="What is this driving toward?"
          value={stream.outcome}
          onChange={(e) => set((s) => ({ ...s, outcome: e.target.value }))}
        />

        {stream.state === "parked" && (
          <>
            <label>Wake-up date</label>
            <input
              type="date"
              value={dayValue(stream.wakeUpDate)}
              onChange={(e) =>
                // Guard: the schema rejects a parked stream with no wake-up
                // date, so an empty field must not clear it.
                set((s) => ({ ...s, wakeUpDate: dayOrNull(e.target.value) ?? s.wakeUpDate }))
              }
            />
          </>
        )}

        {stream.state === "waiting" && (
          <>
            <label>Waiting since</label>
            <input
              type="date"
              value={dayValue(stream.waitingSince)}
              onChange={(e) =>
                set((s) => ({ ...s, waitingSince: dayOrNull(e.target.value) ?? s.waitingSince }))
              }
            />
          </>
        )}

        <label>Check-in</label>
        <div className="row">
          <span className="muted">every</span>
          <input
            type="number"
            min={1}
            className="narrow"
            value={stream.checkInCadenceDays ?? ""}
            placeholder="—"
            onChange={(e) =>
              set((s) => ({
                ...s,
                checkInCadenceDays: e.target.value === "" ? null : Math.max(1, +e.target.value),
              }))
            }
          />
          <span className="muted">days</span>
        </div>
      </div>

      <fieldset>
        <legend>Next step</legend>
        <input
          placeholder="What happens next?"
          value={stream.nextStep?.text ?? ""}
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
        {stream.nextStep && (
          <div className="row wrap">
            <button
              className={`chip ${stream.nextStep.owner.kind === "me" ? "is-on" : ""}`}
              onClick={() =>
                set((s) => (s.nextStep ? { ...s, nextStep: { ...s.nextStep, owner: { kind: "me" } } } : s))
              }
            >
              me
            </button>
            <input
              list="known-people"
              placeholder="…or a person's name"
              value={stream.nextStep.owner.kind === "person" ? stream.nextStep.owner.name : ""}
              onChange={(e) =>
                set((s) => {
                  if (!s.nextStep) return s;
                  const name = e.target.value;
                  return {
                    ...s,
                    nextStep: {
                      ...s.nextStep,
                      owner: name ? { kind: "person", name } : { kind: "me" },
                    },
                  };
                })
              }
            />
            <span className="muted">set {stream.nextStep.setAt}</span>
          </div>
        )}
      </fieldset>

      {/* §3.1: autocomplete from previously used names. No contacts integration. */}
      <datalist id="known-people">
        {knownPeople.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <fieldset>
        <legend>Target deadline</legend>
        <DeadlineField stream={stream} set={set} />
        {deadline && (
          <div className="row wrap">
            <span className="muted">from</span>
            <input
              type="date"
              value={deadline.earliest}
              onChange={(e) =>
                set((s) =>
                  s.targetDeadline && e.target.value
                    ? {
                        ...s,
                        targetDeadline: {
                          ...s.targetDeadline,
                          earliest: e.target.value,
                          // Keep the window ordered; the schema rejects inverted ones.
                          latest:
                            e.target.value > s.targetDeadline.latest
                              ? e.target.value
                              : s.targetDeadline.latest,
                        },
                      }
                    : s,
                )
              }
            />
            <span className="muted">to</span>
            <input
              type="date"
              value={deadline.latest}
              min={deadline.earliest}
              onChange={(e) =>
                set((s) =>
                  s.targetDeadline && e.target.value && e.target.value >= s.targetDeadline.earliest
                    ? { ...s, targetDeadline: { ...s.targetDeadline, latest: e.target.value } }
                    : s,
                )
              }
            />
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Next milestone</legend>
        <div className="row wrap">
          <input
            placeholder="Milestone"
            value={stream.nextMilestone?.text ?? ""}
            onChange={(e) =>
              set((s) => {
                const text = e.target.value;
                if (!text) return { ...s, nextMilestone: null };
                return {
                  ...s,
                  nextMilestone: s.nextMilestone
                    ? { ...s.nextMilestone, text }
                    : { text, date: toDay(new Date()) },
                };
              })
            }
          />
          {stream.nextMilestone && (
            <input
              type="date"
              value={stream.nextMilestone.date}
              onChange={(e) =>
                set((s) =>
                  s.nextMilestone && e.target.value
                    ? { ...s, nextMilestone: { ...s.nextMilestone, date: e.target.value } }
                    : s,
                )
              }
            />
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend>Log</legend>
        <div className="row">
          <input
            placeholder="Add a note…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addNote()}
          />
          <button className="chip" onClick={addNote}>
            Add
          </button>
        </div>
        {stream.log.length === 0 ? (
          <p className="muted">Nothing logged yet.</p>
        ) : (
          <ul className="log">
            {stream.log.map((e) => (
              <li key={e.id}>
                <span className="log-at">{new Date(e.at).toLocaleString()}</span>
                {e.kind !== "manual" && <span className="log-kind">{e.kind}</span>}
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <footer className="detail-footer">
        <span className="muted">last touched {new Date(stream.lastTouched).toLocaleString()}</span>
        <button className="danger" onClick={() => onDelete(stream.id)}>
          Delete stream
        </button>
      </footer>
    </div>
  );
}
