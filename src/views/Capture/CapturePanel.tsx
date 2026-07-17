import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { capture } from "../../core/capture";
import { addDays, toDay } from "../../core/days";
import { Area } from "../../models/area";
import { loadAll, saveStreamNow } from "../../storage/repository";
import { newStream } from "../../models/stream";

/**
 * The floating one-field window (SPEC §4.2).
 *
 * Capture is instant and triage is later: the text becomes a **parked** stream
 * with a 7-day wake-up and nothing else. Asking for an area or a next step here
 * would make you think, and the whole point is to get the thought out of your
 * head before it evaporates.
 */
export function CapturePanel() {
  const [text, setText] = useState("");
  const [areas, setAreas] = useState<Area[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // This window is hidden and re-shown rather than recreated, so it must be
  // told to reset -- otherwise it reopens holding last week's half-typed line.
  useEffect(() => {
    const unlisten = listen("capture:focus", () => {
      setText("");
      setFlash(null);
      inputRef.current?.focus();
    });
    return () => void unlisten.then((f) => f());
  }, []);

  // Areas are read fresh on mount; the list is tiny and this window is rarely
  // open, so staleness costs more than the read does.
  useEffect(() => {
    void loadAll().then((r) => setAreas(r.areas));
  }, []);

  const preview = capture(text, areas);

  const submit = async () => {
    const { title, area } = capture(text, areas);
    if (!title) return;

    const now = new Date();
    const s = newStream(title, area?.id ?? areas[0]?.id ?? "", now, {
      state: "parked",
      wakeUpDate: addDays(toDay(now), 7),
    });
    await saveStreamNow(s);

    setText("");
    setFlash(area ? `Captured → ${area.name}` : "Captured");
    setTimeout(() => void invoke("hide_capture"), 550);
  };

  return (
    <div className="capture" data-tauri-drag-region>
      <input
        ref={inputRef}
        autoFocus
        className="capture-input"
        placeholder="Capture a thought…    >area to file it"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") void invoke("hide_capture");
        }}
      />
      {flash ? (
        <span className="capture-flash">{flash}</span>
      ) : (
        preview.area && <span className="capture-area">{preview.area.name}</span>
      )}
    </div>
  );
}
