/**
 * Quick-capture syntax (SPEC §4.2).
 *
 * `Call the auditors >Acme` -> title "Call the auditors", area "Acme".
 *
 * Capture is meant to be instant — you're mid-thought, the window is open for
 * two seconds. So this parser never rejects: anything it can't read stays part
 * of the title. Losing the thought is a real cost; a mis-filed area is a
 * two-second fix during triage, which is what §4.2 defers to anyway.
 */

export type Capture = {
  title: string;
  /** As typed. Resolution to a real area is the caller's job — see `resolveArea`. */
  areaName: string | null;
};

export function parseCapture(input: string): Capture {
  const text = input.trim();
  if (!text) return { title: "", areaName: null };

  // Last `>` wins: a title may legitimately contain one ("revenue > costs"),
  // and the marker is typed at the end in practice.
  const at = text.lastIndexOf(">");
  if (at === -1) return { title: text, areaName: null };

  const title = text.slice(0, at).trim();
  const areaName = text.slice(at + 1).trim();

  // ">Acme" with no title, or "something >" with no area: not the syntax,
  // just a stray character. Keep the whole thing as the title.
  if (!title || !areaName) return { title: text, areaName: null };

  return { title, areaName };
}

/** Case-insensitive, and prefix-tolerant so `>ac` finds "Acme". */
export function resolveArea<T extends { id: string; name: string }>(
  areaName: string | null,
  areas: T[],
): T | null {
  if (!areaName) return null;
  const needle = areaName.toLowerCase();

  const exact = areas.find((a) => a.name.toLowerCase() === needle);
  if (exact) return exact;

  const prefixed = areas.filter((a) => a.name.toLowerCase().startsWith(needle));
  // Ambiguous prefix -> no match. Guessing between two areas silently files the
  // thought somewhere you won't look for it.
  return prefixed.length === 1 ? prefixed[0] : null;
}

/**
 * What capture actually calls. `>x` counts as syntax only if `x` names a real
 * area; otherwise the `>` was punctuation and the whole text is the title.
 *
 * Without this rule, "revenue > costs" -- a perfectly ordinary stream title --
 * parses to title "revenue", area "costs"; the area then fails to resolve and is
 * dropped, and half the thought goes with it. Since §4.2 defers triage anyway,
 * the worst case here is an unfiled stream, never a truncated one.
 */
export function capture<T extends { id: string; name: string }>(
  input: string,
  areas: T[],
): { title: string; area: T | null } {
  const { title, areaName } = parseCapture(input);
  const area = resolveArea(areaName, areas);
  if (areaName !== null && area === null) return { title: input.trim(), area: null };
  return { title, area };
}
