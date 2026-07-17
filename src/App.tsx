import { useEffect, useState } from "react";
import { attentionCount } from "./core/attentionEngine";
import { AttentionView } from "./views/Attention/AttentionView";
import { Sidebar } from "./views/Sidebar/Sidebar";
import { StreamDetail } from "./views/StreamDetail/StreamDetail";
import { StreamList } from "./views/StreamList/StreamList";
import { useStore } from "./storage/useStore";
import "./styles.css";

/**
 * SPEC's guiding principle: "The attention view is the app; the list is just the
 * database." So Attention is the launch screen and the list is somewhere you go,
 * not the default.
 */
type Screen = "attention" | "list";

export default function App() {
  const store = useStore();
  const [screen, setScreen] = useState<Screen>("attention");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);

  // Re-evaluated on every render; `now` only needs to be fresh enough that a
  // date rolling over eventually shows up. A long-lived window ticks it here.
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

  const open = (id: string) => {
    setStreamId(id);
    setScreen("list");
  };

  const createHere = (title: string) => {
    const target = areaId ?? store.areas[0]?.id;
    if (!target) return;
    void store.createStream(title, target).then((s) => setStreamId(s.id));
  };

  const count = attentionCount(store.streams, now);

  return (
    <div className={screen === "attention" ? "app app-attention" : "app"}>
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
        attentionCount={count}
        onShowAttention={() => setScreen("attention")}
      />

      {screen === "attention" ? (
        <main className="pane pane-wide">
          <InvalidBanner store={store} />
          <AttentionView
            streams={store.streams}
            areas={store.areas}
            now={now}
            onOpen={open}
            onCompleteStep={store.completeStep}
            onCheckIn={store.checkIn}
            onSnooze={store.snooze}
          />
        </main>
      ) : (
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
                onUpdate={store.updateStream}
                onAppendLog={store.appendLog}
                onDelete={(id) => void store.removeStream(id)}
              />
            ) : (
              <p className="empty">Select a stream, or create one.</p>
            )}
          </main>
        </>
      )}
    </div>
  );
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
