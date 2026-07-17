import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { AttentionItem, AttentionOptions, attentionItems } from "./core/attentionEngine";
import { shouldSuggestReview } from "./core/review";
import { waitingByPerson } from "./core/waiting";
import { ArchiveView } from "./views/Archive/ArchiveView";
import { AttentionView } from "./views/Attention/AttentionView";
import { Sidebar } from "./views/Sidebar/Sidebar";
import { StreamDetail } from "./views/StreamDetail/StreamDetail";
import { ReviewView } from "./views/Review/ReviewView";
import { StreamList } from "./views/StreamList/StreamList";
import { WaitingView } from "./views/Waiting/WaitingView";
import { digestDue, notifyDigest, notifyEvents } from "./services/notifications";
import { toDay } from "./core/days";
import { useStore } from "./storage/useStore";
import "./styles.css";

/**
 * SPEC's guiding principle: "The attention view is the app; the list is just the
 * database." So Attention is the launch screen and everything else is somewhere
 * you go, not the default.
 */
export type Screen = "attention" | "waiting" | "archive" | "list" | "review";

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

  // Tray routing: a click in the menu bar opens that stream (§4.1).
  useEffect(() => {
    const un = listen<string>("tray:open-stream", (e) => {
      setStreamId(e.payload);
      setScreen("list");
    });
    return () => void un.then((f) => f());
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

  const items = attentionItems(store.streams, now, opts);
  const suggestion = shouldSuggestReview(store.streams, now, store.settings.lastReviewAt, opts);
  const reviewing = store.settings.activeReviewStartedAt !== null;

  const beginReview = () => {
    void store.startReview().then(() => setScreen("review"));
  };
  const endReview = () => {
    void store.finishReview().then(() => setScreen("attention"));
  };

  const wide = screen !== "list";

  return (
    <div className={wide ? "app app-wide" : "app"}>
      <AmbientSync items={items} digestTime={store.settings.digestTime} now={now} />
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
        onGoTo={(t) => (t === "review" && !reviewing ? beginReview() : setScreen(t))}
        attentionCount={items.length}
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
          {screen === "attention" && suggestion.suggest && !reviewing && (
            // §3.4's nudge. Dismissible by acting, not by an X: an ignorable
            // banner is one you stop seeing.
            <div className="suggest">
              <span>
                <strong>Time for a weekly review</strong> — {suggestion.reason}.
              </span>
              <button className="chip" onClick={beginReview}>
                Start review
              </button>
            </div>
          )}
          {screen === "attention" && reviewing && (
            <div className="suggest">
              <span>
                <strong>Review in progress</strong> — picked up where you left off.
              </span>
              <button className="chip" onClick={() => setScreen("review")}>
                Resume
              </button>
            </div>
          )}
          {screen === "review" && store.settings.activeReviewStartedAt && (
            <ReviewView
              streams={store.streams}
              areas={store.areas}
              startedAt={store.settings.activeReviewStartedAt}
              knownPeople={peopleOf(store.streams)}
              onUpdate={store.updateStream}
              onFinish={endReview}
              onOpen={open}
            />
          )}
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

/**
 * The ambient half of the app (SPEC §4.1, §4.3): keep the tray in step with the
 * attention set, and fire notifications.
 *
 * A component rather than an effect in App because `items` is computed after
 * App's early returns, and hooks can't live there. It renders nothing.
 */
function AmbientSync({
  items,
  digestTime,
  now,
}: {
  items: AttentionItem[];
  digestTime: string;
  now: Date;
}) {
  // The tray count comes from the same array the view renders, so §4.1's
  // "number of streams" can never disagree with what's on screen.
  useEffect(() => {
    void invoke("update_tray", {
      count: items.length,
      items: items.slice(0, 5).map((i) => ({
        id: i.stream.id,
        title: i.stream.title,
        detail: i.detail,
      })),
    }).catch((e) => console.error("tray update failed", e));
  }, [items]);

  useEffect(() => {
    const today = toDay(now);
    void notifyEvents(items, today);
    if (digestDue(now, digestTime)) void notifyDigest(items, today);
  }, [items, now, digestTime]);

  return null;
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
