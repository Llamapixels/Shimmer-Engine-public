import type { ReactNode } from "react";
import "./FieldRow.css";

interface Props {
  label: string;
  hint?: string;
  children: ReactNode;
}

/** One labeled field in the properties panel - every scene/door/NPC
 * field below is built from this so the panel stays visually
 * consistent without repeating the label/hint markup at every call
 * site. */
export default function FieldRow({ label, hint, children }: Props) {
  return (
    <label className="field-row">
      <span className="field-row-label">{label}</span>
      {children}
      {hint && <span className="field-row-hint">{hint}</span>}
    </label>
  );
}
