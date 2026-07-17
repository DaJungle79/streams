import { useEffect, useState } from "react";
import { AttentionOptions, attentionCount } from "./core/attentionEngine";
import { waitingByPerson } from "./core/waiting";
import { ArchiveView } from "./views/Archive/ArchiveView";
import { AttentionView } from "./views/Attention/AttentionView";
import { Sidebar } from "./views/Sidebar/Sidebar";
import { StreamDetail } from "./views/StreamDetail/StreamDetail";
import { StreamList } from "./views/StreamList/StreamList";
import { WaitingView } from "./views/Waiting/WaitingView";
import { useStore } from "./storage/useStore";
import "./styles.css";

/**
 * SPEC's guiding principle: "The attention view is the app; the list is just the
 * database." So Attention is the launch screen and everything else is somewhere
 * you go, not the default.
 */
export type Screen = "attention" | "waiting" | "archive" | "list";

export default function App() {
  const store = useStore();
  const [screen, setScreen] = useState<Screen>("attention");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);

  // A long-lived window must notice the date rolling over, or a wake-up set for
  // tomorrow never fires until you restart the app.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const selected = store.streams.find((s) => s.id === streamId) ?? null;

  useEffect(() => {
    if (streamId && !store.streams.some((s) => s.id === streamId)) setStreamId(null);
  }, [store.streams, streamId]);

  if (store.loading) return <div className="boot">Loading…</div>;
  if (store.error) {
    return (
      <div className="boot boot-error">
        <h1>Couldn't open the store</h1>
        <pre>{store.error}</pre>
      </div>
    );
  }

  // Settings drive the engine, so the §8 safety net and the §2.4 threshold are
  // one file away from being tuned — not recompiled.
  const opts: AttentionOptions = {
    waitingThresholdDays: store.settings.waitingThresholdDays,
    milestoneHorizonDays: store.settings.milestoneHorizonDays,
    defaultCheckInCadenceDays: store.settings.defaultCheckInCadenceDays,
  };

  const open = (id: string) => {
    setStreamId(id);
    setScreen("list");
  };

  const createHere = (title: string) => {
    const target = areaId ?? store.areas[0]?.id;
    if (!target) return;
    void store.createStream(title, target).then((s) => setStreamId(s.id));
  };

  const wide = screen !== "list";

  return (
    <div className={wide ? "app app-wide" : "app"}>
      <Sidebar
        areas={store.areas}
        streams={store.streams}
        selectedAreaId={areaId}
        onSelectArea={(id) => {
          setAreaId(id);
          setScreen("list");
        }}
        onCreateArea={(n, c) => void store.createArea(n, c)}
        screen={screen}
        onGoTo={setScreen}
        attentionCount={attentionCount(store.streams, now, opts)}
        waitingCount={waitingByPerson(store.streams, now).length}
      />

      {screen === "list" ? (
        <>
          <StreamList
            streams={store.streams}
            areas={store.areas}
            selectedAreaId={areaId}
            selectedStreamId={streamId}
            onSelectStream={setStreamId}
            onCreateStream={createHere}
          />
          <main className="pane">
            <InvalidBanner store={store} />
            {selected ? (
              <StreamDetail
                stream={selected}
                areas={store.areas}
                knownPeople={peopleOf(store.streams)}
                onUpdate={store.updateStream}
                onAppendLog={store.appendLog}
                onDelete={(id) => void store.removeStream(id)}
              />
            ) : (
              <p className="empty">Select a stream, or create one.</p>
            )}
          </main>
        </>
      ) : (
        <main className="pane pane-wide">
          <InvalidBanner store={store} />
          {screen === "attention" && (
            <AttentionView
              streams={store.streams}
              areas={store.areas}
              now={now}
              opts={opts}
              onOpen={open}
              onCompleteStep={store.completeStep}
              onCheckIn={store.checkIn}
              onSnooze={store.snooze}
            />
          )}
          {screen === "waiting" && (
            <WaitingView
              streams={store.streams}
              areas={store.areas}
              now={now}
              waitingThresholdDays={opts.waitingThresholdDays}
              onOpen={open}
              onNudge={store.nudge}
            />
          )}
          {screen === "archive" && (
            <ArchiveView
              streams={store.streams}
              areas={store.areas}
              selectedAreaId={areaId}
              onOpen={open}
              onReactivate={store.reactivate}
            />
          )}
        </main>
      )}
    </div>
  );
}

function peopleOf(streams: ReturnType<typeof useStore>["streams"]): string[] {
  const names = new Set<string>();
  for (const s of streams) if (s.nextStep?.owner.kind === "person") names.add(s.nextStep.owner.name);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Files that exist but don't parse are shown, never swallowed. A store that
 * silently drops a stream is the exact failure this app exists to prevent.
 */
function InvalidBanner({ store }: { store: ReturnType<typeof useStore> }) {
  if (store.invalid.length === 0) return null;
  return (
    <div className="warn">
      <strong>{store.invalid.length} file(s) on disk could not be read:</strong>
      <ul>
        {store.invalid.map((i) => (
          <li key={i.name}>
            <code>{i.name}</code> — {i.error}
          </li>
        ))}
      </ul>
    </div>
  );
}
