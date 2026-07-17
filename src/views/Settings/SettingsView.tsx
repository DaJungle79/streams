import { Area } from "../../models/area";
import { Settings } from "../../models/settings";
import { Stream } from "../../models/stream";
import { RemindersMirror } from "./RemindersMirror";
import { LoginItem } from "./LoginItem";
import { StoreFolder } from "./StoreFolder";

type Props = {
  settings: Settings;
  streams: Stream[];
  areas: Area[];
  onChange: (edit: (s: Settings) => Settings) => void;
};

/** A number field that can't be emptied into an invalid state. */
function NumberRow({
  label,
  hint,
  value,
  min = 1,
  onChange,
  nullable = false,
}: {
  label: string;
  hint: string;
  value: number | null;
  min?: number;
  onChange: (v: number | null) => void;
  nullable?: boolean;
}) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        <span className="muted set-hint">{hint}</span>
      </div>
      <input
        type="number"
        min={min}
        className="narrow"
        placeholder={nullable ? "off" : undefined}
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            // Only some fields can be emptied. The rest keep their value rather
            // than accept a NaN that the schema would reject on save.
            if (nullable) onChange(null);
            return;
          }
          onChange(Math.max(min, Number(raw)));
        }}
      />
    </div>
  );
}

export function SettingsView({ settings, streams, areas, onChange }: Props) {
  return (
    <div className="attention">
      <header className="att-header">
        <h1>Settings</h1>
      </header>

      <section className="att-group set-group">
        <h2 className="att-group-title">Store</h2>
        <StoreFolder />
      </section>

      <section className="att-group set-group">
        <h2 className="att-group-title">Startup</h2>
        <LoginItem />
        <p className="muted set-hint">
          The window stays closed on a login launch — the menu bar is the point. ⌥⌘S captures
          from anywhere.
        </p>
      </section>

      <section className="att-group set-group">
        <h2 className="att-group-title">Apple Reminders</h2>
        <RemindersMirror streams={streams} areas={areas} />
      </section>

      <section className="att-group set-group">
        <h2 className="att-group-title">Attention</h2>

        <NumberRow
          label="Default check-in"
          // This is SPEC §8's safety net: without it, a stream with a next step
          // and no dates would never surface. Say so, or it looks like a default
          // worth switching off.
          hint="days — streams with no cadence of their own inherit this. Empty means nothing catches a stream that has no dates."
          value={settings.defaultCheckInCadenceDays}
          nullable
          onChange={(v) => onChange((s) => ({ ...s, defaultCheckInCadenceDays: v }))}
        />

        <NumberRow
          label="Waiting too long"
          hint="days before a stream waiting on someone else is surfaced"
          value={settings.waitingThresholdDays}
          onChange={(v) => onChange((s) => ({ ...s, waitingThresholdDays: v ?? s.waitingThresholdDays }))}
        />

        <NumberRow
          label="Milestone horizon"
          hint="days ahead a milestone starts asking for attention"
          value={settings.milestoneHorizonDays}
          onChange={(v) => onChange((s) => ({ ...s, milestoneHorizonDays: v ?? s.milestoneHorizonDays }))}
        />

        <div className="set-row">
          <div className="set-label">
            <span>Daily digest</span>
            <span className="muted set-hint">
              one notification for all overdue check-ins — never one per stream
            </span>
          </div>
          <input
            type="time"
            value={settings.digestTime}
            onChange={(e) => e.target.value && onChange((s) => ({ ...s, digestTime: e.target.value }))}
          />
        </div>
      </section>
    </div>
  );
}
