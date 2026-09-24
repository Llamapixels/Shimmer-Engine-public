import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  /** Called on blur / Enter with the new text. Return an error message
   * to reject it (the field shows the error and keeps the draft). */
  onCommit: (value: string) => string | null | void;
  placeholder?: string;
  className?: string;
}

/**
 * A text field that only commits when you're done (Enter or leaving the
 * field) instead of on every keystroke - for renames, where each
 * intermediate value would otherwise rewrite references across the
 * project ("s", "sh", "sho"...). Escape reverts.
 */
export default function CommitInput({ value, onCommit, placeholder, className }: Props) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  // What this edit is *for*, captured when editing starts. If the thing
  // being edited changes underneath (e.g. clicking another NPC on the
  // canvas re-renders this field for that NPC before the blur fires),
  // the pending text still commits to the original target.
  const editing = useRef<{ value: string; onCommit: Props["onCommit"] } | null>(null);

  useEffect(() => {
    if (editing.current) return;
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = () => {
    const target = editing.current ?? { value, onCommit };
    editing.current = null;
    if (draft === target.value) {
      setError(null);
      setDraft(value);
      return;
    }
    const err = target.onCommit(draft);
    if (target.value !== value) {
      // The field now shows something else - show its value, and don't
      // pin the old target's error on it.
      setDraft(value);
      setError(null);
    } else {
      setError(err || null);
    }
  };

  return (
    <>
      <input
        className={`${className ?? ""}${error ? " select-invalid" : ""}`}
        value={draft}
        placeholder={placeholder}
        onFocus={() => {
          editing.current = { value, onCommit };
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(editing.current?.value ?? value);
            setError(null);
          }
        }}
      />
      {error && <span className="field-error">{error}</span>}
    </>
  );
}
