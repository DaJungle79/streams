import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onCommit: (value: string) => void;
  /** Live keystrokes, for previews. Must NOT be used to mutate the model. */
  onDraft?: (value: string) => void;
  placeholder?: string;
  className?: string;
  list?: string;
  disabled?: boolean;
  autoFocus?: boolean;
};

/**
 * A text field that commits on blur (or Enter), not on every keystroke.
 *
 * This is not a performance nicety. `updateStream` runs `structuralEvents` on
 * every change, so a field whose edits are logged -- the next step (§3.3's
 * step-changed) and the deadline label (deadline-changed) -- would otherwise
 * write one log entry *per character*: "c" -> "ca" -> "cal". The log's whole
 * value is that everything in it is worth reading (§8's one-minute context
 * reload), and eight entries to record typing "call Bob" destroys that.
 *
 * Escape reverts to the model value, which is the only way to abandon a typo
 * once the field is the source of truth while focused.
 */
export function DraftInput({
  value,
  onCommit,
  onDraft,
  placeholder,
  className,
  list,
  disabled,
  autoFocus,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  // While focused the draft owns the field; when not, the model does. Without
  // this the field would fight an external change (a review edit, a synced
  // update) mid-type.
  useEffect(() => {
    if (draft !== null && document.activeElement !== ref.current) setDraft(null);
  }, [value, draft]);

  const shown = draft ?? value;

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      ref={ref}
      list={list}
      disabled={disabled}
      autoFocus={autoFocus}
      className={className}
      placeholder={placeholder}
      value={shown}
      onChange={(e) => {
        setDraft(e.target.value);
        onDraft?.(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(null);
          onDraft?.(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * The same contract for multi-line text. Enter inserts a newline here rather
 * than committing — an outcome is a sentence, not a field.
 */
export function DraftTextarea({
  value,
  onCommit,
  placeholder,
  rows = 2,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (draft !== null && document.activeElement !== ref.current) setDraft(null);
  }, [value, draft]);

  return (
    <textarea
      ref={ref}
      rows={rows}
      placeholder={placeholder}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        setDraft(null);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
