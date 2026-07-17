import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { AttentionItem } from "../core/attentionEngine";

/**
 * Native notifications (SPEC §4.3).
 *
 * M0 confirmed these fire from an ad-hoc-signed build, so there's no
 * `terminal-notifier` fallback here.
 *
 * The hard rule of this file is **one notification per event, ever**. A tool
 * that double-notifies gets its notifications turned off, and then §4.3 is worth
 * nothing. Delivery is therefore keyed and remembered.
 */

export async function ensurePermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

/**
 * What has already been delivered, as stable keys.
 *
 * Machine-local on purpose: it lives in localStorage rather than the synced
 * store. Two Macs each notifying you once is correct -- you're at one of them --
 * whereas syncing this would mean whichever Mac saw it first silences the other.
 */
const DELIVERED_KEY = "streams.notified.v1";

function delivered(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DELIVERED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function remember(keys: Set<string>): void {
  // Keep it bounded: these keys are day-stamped, so old ones are dead weight.
  const trimmed = [...keys].slice(-500);
  localStorage.setItem(DELIVERED_KEY, JSON.stringify(trimmed));
}

/**
 * A key that is stable for one event, and changes when the event recurs.
 *
 * Day-stamped, so a milestone that's still overdue tomorrow is a *new* event and
 * notifies once more -- but re-rendering the view fifty times today notifies
 * zero more times.
 */
function keyFor(item: AttentionItem, today: string): string {
  return `${item.stream.id}:${item.reason}:${today}`;
}

/** §4.3's per-event alerts: milestone, deadline window, wake-up. */
const NOTIFIABLE: AttentionItem["reason"][] = ["deadline-window", "waking-up"];

export async function notifyEvents(items: AttentionItem[], today: string): Promise<number> {
  const due = items.filter((i) => NOTIFIABLE.includes(i.reason));
  if (due.length === 0) return 0;
  if (!(await ensurePermission())) return 0;

  const seen = delivered();
  let sent = 0;

  for (const item of due) {
    const key = keyFor(item, today);
    if (seen.has(key)) continue;
    sendNotification({ title: item.stream.title, body: item.detail });
    seen.add(key);
    sent++;
  }

  if (sent > 0) remember(seen);
  return sent;
}

/**
 * §4.3: check-ins are "batched into one daily digest ... not one notification
 * per stream". That sentence is the whole design -- twenty streams going
 * overdue on the same morning must cost you one banner, not twenty.
 */
export async function notifyDigest(items: AttentionItem[], today: string): Promise<boolean> {
  const overdue = items.filter((i) => i.reason === "check-in-overdue");
  if (overdue.length === 0) return false;

  const key = `digest:${today}`;
  const seen = delivered();
  if (seen.has(key)) return false;
  if (!(await ensurePermission())) return false;

  const names = overdue.slice(0, 3).map((i) => i.stream.title);
  const rest = overdue.length - names.length;
  sendNotification({
    title: `${overdue.length} check-in${overdue.length === 1 ? "" : "s"} overdue`,
    body: names.join(", ") + (rest > 0 ? `, and ${rest} more` : ""),
  });

  seen.add(key);
  remember(seen);
  return true;
}

/** Has the digest time passed today? */
export function digestDue(now: Date, digestTime: string): boolean {
  const [h, m] = digestTime.split(":").map(Number);
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
}
