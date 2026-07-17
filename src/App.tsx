import { useEffect, useState } from "react";
import { Sidebar } from "./views/Sidebar/Sidebar";
import { StreamDetail } from "./views/StreamDetail/StreamDetail";
import { StreamList } from "./views/StreamList/StreamList";
import { useStore } from "./storage/useStore";
import "./styles.css";

export default function App() {
  const store = useStore();
  const [areaId, setAreaId] = useState<string | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);

  const selected = store.streams.find((s) => s.id === streamId) ?? null;

  // If the selected stream is deleted, drop the selection rather than render a
  // stale detail pane.
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

  const createHere = (title: string) => {
    const target = areaId ?? store.areas[0]?.id;
    if (!target) return;
    void store.createStream(title, target).then((s) => setStreamId(s.id));
  };

  return (
    <div className="app">
      <Sidebar
        areas={store.areas}
        streams={store.streams}
        selectedAreaId={areaId}
        onSelectArea={setAreaId}
        onCreateArea={(n, c) => void store.createArea(n, c)}
      />

      <StreamList
        streams={store.streams}
        areas={store.areas}
        selectedAreaId={areaId}
        selectedStreamId={streamId}
        onSelectStream={setStreamId}
        onCreateStream={createHere}
      />

      <main className="pane">
        {/*
          Files that exist but don't parse are shown, never swallowed. A store
          that silently drops a stream is the exact failure this app exists to
          prevent (SPEC §8).
        */}
        {store.invalid.length > 0 && (
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
        )}

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
    </div>
  );
}
