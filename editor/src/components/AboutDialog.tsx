import { useEffect, useState } from "react";

import "./AboutDialog.css";

// The picture under the words: editor/src/assets/about.(png|jpg|jpeg|gif|webp),
// picked up at build time if it's there.
const images = import.meta.glob("../assets/about.{png,jpg,jpeg,gif,webp}", { eager: true, query: "?url", import: "default" }) as Record<
  string,
  string
>;
const aboutImage = Object.values(images)[0] as string | undefined;

/** Help > About Shimmer Engine. */
export default function AboutDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => window.api?.onShowAbout?.(() => setOpen(true)), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="about-backdrop" onMouseDown={() => setOpen(false)} data-testid="about-dialog">
      <div className="about-dialog" role="dialog" aria-label="About Shimmer Engine" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="about-title">Shimmer Engine</h2>
        <p className="about-text">
          Made by HoloCatt with love
          <br />
          inspired by GB STUDIO making me realize anything is possible if you set your mind to it.
        </p>
        {aboutImage && <img className="about-image" src={aboutImage} alt="" />}
        <button className="btn btn-primary" onClick={() => setOpen(false)} autoFocus>
          Close
        </button>
      </div>
    </div>
  );
}
