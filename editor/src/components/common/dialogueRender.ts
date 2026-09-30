/**
 * Draws dialogue boxes the way the game does: fonts read like
 * compiler/ui.py's load_font(), text laid out like engine/source/dialogue.c
 * (word wrap over 2 lines, a new line starts a new page, overflow carries
 * on to the next page, "!F:name!" switches font).
 */

export const BOX_W = 240;
export const BOX_H = 32;
const TEXT_X = 8;
const TEXT_Y = 8;
const TEXT_WIDTH = 224; // ui.h UI_TEXT_WIDTH
const TEXT_LINES = 2; // dialogue.c TEXT_LINES
const TILE = 8;

export interface UiFont {
  img: ImageData;
  first: number;
  count: number;
  cols: number;
  /** "r,g,b" of the see-through background colour, if any. */
  bg: string | null;
  left: number[];
  width: number[];
}

function imageData(img: HTMLImageElement): ImageData {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height);
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const isTrim = (d: Uint8ClampedArray, i: number) => d[i + 3] < 128 || (d[i] > 249 && d[i + 2] > 249 && d[i + 1] < 10);
const rgb = (d: Uint8ClampedArray, i: number) => `${d[i]},${d[i + 1]},${d[i + 2]}`;

/** compiler/ui.py load_font(), minus the .json mapping. */
export function parseFont(img: HTMLImageElement): UiFont | null {
  const d = imageData(img);
  const cols = Math.floor(d.width / TILE);
  const rows = Math.floor(d.height / TILE);
  if (cols < 1 || rows < 1) return null;
  const first = cols * rows <= 224 ? 32 : 0;
  const count = Math.min(cols * rows, 256 - first);
  const at = (x: number, y: number) => (y * d.width + x) * 4;

  const counts = new Map<string, number>();
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const i = at(x, y);
      if (!isTrim(d.data, i)) counts.set(rgb(d.data, i), (counts.get(rgb(d.data, i)) ?? 0) + 1);
    }
  const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const left: number[] = [];
  const width: number[] = [];
  let variable = false;
  for (let n = 0; n < count; n++) {
    const cx = (n % cols) * TILE;
    const cy = Math.floor(n / cols) * TILE;
    const used: number[] = [];
    for (let x = 0; x < TILE; x++) {
      let any = false;
      for (let y = 0; y < TILE; y++) if (!isTrim(d.data, at(cx + x, cy + y))) any = true;
      if (any) used.push(x);
    }
    if (used.length && (used[0] > 0 || used[used.length - 1] < TILE - 1)) variable = true;
    left.push(used.length ? used[0] : 0);
    width.push(used.length ? used[used.length - 1] - used[0] + 1 : 0);
  }
  if (!variable) {
    for (let n = 0; n < count; n++) {
      left[n] = 0;
      width[n] = TILE;
    }
  } else if (first <= 32 && 32 < first + count && width[32 - first] === 0) width[32 - first] = 3;
  return { img: d, first, count, cols, bg, left, width };
}

/** A 24x24 frame (3x3 tiles), or null. */
export function parseFrame(img: HTMLImageElement): ImageData | null {
  return img.width === 24 && img.height === 24 ? imageData(img) : null;
}

/** Character -> glyph index in the font (Latin-1; anything else is "?"). */
function glyph(font: UiFont, ch: string): number {
  let code = ch.charCodeAt(0);
  if (code > 255) code = 63;
  let n = code - font.first;
  if (n < 0 || n >= font.count) n = 63 - font.first;
  return n >= 0 && n < font.count ? n : -1;
}

const charWidth = (font: UiFont, ch: string) => {
  const n = glyph(font, ch);
  return n < 0 ? 0 : font.width[n];
};

type Item = { kind: "char"; ch: string } | { kind: "font"; name: string } | { kind: "space" };

/** Text -> items, as build_project.py's interpolate_vars() reads it:
 * {var} shows as a number (0 here), !S5! only changes speed. */
function tokenize(text: string): Item[] {
  const out: Item[] = [];
  const re = /\{([^{}]+)\}|!F:([^!]+)!|!S:?(\d+)!/g;
  let pos = 0;
  const plain = (s: string) => {
    for (const ch of s) out.push(ch === " " ? { kind: "space" } : { kind: "char", ch });
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    plain(text.slice(pos, m.index));
    pos = m.index + m[0].length;
    if (m[1] !== undefined) out.push({ kind: "char", ch: "0" });
    else if (m[2] !== undefined) out.push({ kind: "font", name: m[2].trim() });
  }
  plain(text.slice(pos));
  return out;
}

export interface Glyph {
  font: string;
  ch: string;
  x: number;
  line: number;
}

/** Pages of placed characters, following dialogue.c's layout(). */
export function layoutPages(text: string, fonts: Record<string, UiFont>, startFont: string): Glyph[][] {
  const pages: Glyph[][] = [];
  let font = startFont;
  const paragraphs = text.split("\n");
  while (paragraphs.length > 1 && paragraphs[paragraphs.length - 1] === "") paragraphs.pop();
  for (const para of paragraphs) {
    const items = tokenize(para);
    let page: Glyph[] = [];
    let line = 0;
    let x = 0;
    let i = 0;
    while (i < items.length) {
      const it = items[i];
      const f = fonts[font];
      if (it.kind === "space") {
        if (x > 0 && f) x += charWidth(f, " ");
        i++;
        continue;
      }
      // A word: its width, following font codes inside it.
      let w = 0;
      let wf = font;
      let j = i;
      for (; j < items.length && items[j].kind !== "space"; j++) {
        const t = items[j];
        if (t.kind === "font") {
          if (fonts[t.name]) wf = t.name;
        } else if (t.kind === "char" && fonts[wf]) w += charWidth(fonts[wf], t.ch);
      }
      if (x > 0 && x + w > TEXT_WIDTH) {
        line++;
        x = 0;
      }
      if (line >= TEXT_LINES) {
        pages.push(page);
        page = [];
        line = 0;
        x = 0;
      }
      for (; i < j; i++) {
        const t = items[i];
        if (t.kind === "font") {
          if (fonts[t.name]) font = t.name;
        } else if (t.kind === "char" && fonts[font]) {
          if (x < TEXT_WIDTH) page.push({ font, ch: t.ch, x, line });
          x += charWidth(fonts[font], t.ch);
        }
      }
    }
    pages.push(page);
  }
  return pages;
}

/** One page as a 240x32 box: the frame's 9-slice, then the text. */
export function drawPage(page: Glyph[], fonts: Record<string, UiFont>, frame: ImageData | null): ImageData {
  const out = new ImageData(BOX_W, BOX_H);
  const put = (x: number, y: number, d: Uint8ClampedArray, i: number) => {
    if (x < 0 || y < 0 || x >= BOX_W || y >= BOX_H) return;
    const o = (y * BOX_W + x) * 4;
    out.data[o] = d[i];
    out.data[o + 1] = d[i + 1];
    out.data[o + 2] = d[i + 2];
    out.data[o + 3] = 255;
  };
  if (frame) {
    const tw = BOX_W / TILE;
    const th = BOX_H / TILE;
    for (let ty = 0; ty < th; ty++)
      for (let tx = 0; tx < tw; tx++) {
        const sx = tx === 0 ? 0 : tx === tw - 1 ? 2 : 1;
        const sy = ty === 0 ? 0 : ty === th - 1 ? 2 : 1;
        for (let y = 0; y < TILE; y++)
          for (let x = 0; x < TILE; x++) {
            const i = ((sy * TILE + y) * 24 + sx * TILE + x) * 4;
            if (frame.data[i + 3] >= 128) put(tx * TILE + x, ty * TILE + y, frame.data, i);
          }
      }
  }
  for (const g of page) {
    const f = fonts[g.font];
    const n = f ? glyph(f, g.ch) : -1;
    if (!f || n < 0) continue;
    const cx = (n % f.cols) * TILE;
    const cy = Math.floor(n / f.cols) * TILE;
    const left = f.left[n];
    for (let y = 0; y < TILE; y++)
      for (let px = left; px < TILE; px++) {
        const i = ((cy + y) * f.img.width + cx + px) * 4;
        if (isTrim(f.img.data, i) || rgb(f.img.data, i) === f.bg) continue;
        const dx = g.x + px - left;
        if (dx < TEXT_WIDTH) put(TEXT_X + dx, TEXT_Y + g.line * TILE + y, f.img.data, i);
      }
  }
  return out;
}

/** Font names a text switches to with !F:name!. */
export function fontsIn(text: string): string[] {
  return [...text.matchAll(/!F:([^!]+)!/g)].map((m) => m[1].trim());
}
