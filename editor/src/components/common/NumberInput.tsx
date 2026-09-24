import { useEffect, useState } from "react";

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * A whole-number input that lets you clear the field or type "-" on the
 * way to a number without it snapping to 0 mid-typing: the text is kept
 * locally, and only a valid, in-range integer is committed upward. On
 * blur it shows the committed value again.
 */
export default function NumberInput({ value, onChange, min, max, className, title, ariaLabel, disabled }: Props) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  const commit = (raw: string) => {
    if (!/^-?\d+$/.test(raw.trim())) return;
    let n = parseInt(raw, 10);
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    if (n !== value) onChange(n);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      className={className}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      value={focused ? text : String(value)}
      onFocus={(e) => {
        setFocused(true);
        setText(String(value));
        e.currentTarget.select();
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const step = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1);
          const next = (/^-?\d+$/.test(text) ? parseInt(text, 10) : value) + step;
          setText(String(next));
          commit(String(next));
        }
      }}
    />
  );
}
