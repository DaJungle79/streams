import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";

/**
 * SPEC §4.4: register as a login item, toggleable.
 *
 * The main window stays closed on a login launch — the tray is the point. This
 * is the switch that makes the app ambient rather than something you remember
 * to open, which is the same thing as saying it's what makes §2 work at all.
 */
export function LoginItem() {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void isEnabled()
      .then(setOn)
      .catch((e) => setError(String(e)));
  }, []);

  const toggle = async () => {
    try {
      if (on) {
        await disable();
        setOn(false);
      } else {
        await enable();
        setOn(true);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  if (on === null) return null;

  return (
    <div className="loginitem">
      <button className={`chip ${on ? "is-on" : ""}`} onClick={() => void toggle()}>
        {on ? "✓ Launches at login" : "Launch at login"}
      </button>
      {error && <span className="muted">{error}</span>}
    </div>
  );
}
