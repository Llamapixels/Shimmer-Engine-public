import { fromAbsRow, toAbsRow, useMusicStore } from "../../music/musicStore";
import { CHANNELS, CHANNEL_COUNT, addPatternBlock, blockCount, createSequenceItem } from "../../music/song";

/**
 * The song's order list: which pattern block plays at each position.
 * Click a position to jump the piano roll there; the buttons add, copy,
 * repeat, move and remove positions.
 */
export default function SequenceBar() {
  const song = useMusicStore((s) => s.song);
  const cursorRow = useMusicStore((s) => s.cursorRow);
  const channel = useMusicStore((s) => s.channel);
  const edit = useMusicStore((s) => s.edit);
  const setSelection = useMusicStore((s) => s.setSelection);
  if (!song) return null;

  const current = Math.min(fromAbsRow(cursorRow).order, song.sequence.length - 1);
  const go = (order: number) => setSelection([], toAbsRow(order, 0));
  const blocks = blockCount(song);

  const insertAfter = (make: (song: import("../../music/song").Song) => import("../../music/song").SequenceItem) => {
    edit((s) => s.sequence.splice(current + 1, 0, make(s)));
    go(current + 1);
  };

  return (
    <div className="sequence-bar">
      <span className="sequence-label">Sequence</span>
      <div className="sequence-items">
        {song.sequence.map((item, i) => (
          <button
            key={i}
            className={`sequence-item${i === current ? " sequence-item-on" : ""}`}
            onClick={() => go(i)}
            title={item.splitPattern ? `Position ${i + 1}: channels play patterns ${item.channels.join(", ")}` : `Position ${i + 1}: pattern ${Math.floor(item.channels[0] / CHANNEL_COUNT)}`}
          >
            <span className="sequence-pos">{i + 1}</span>
            <span className={`sequence-pat${item.splitPattern ? " sequence-pat-split" : ""}`}>
              {item.splitPattern ? item.channels[channel] : String(Math.floor(item.channels[0] / CHANNEL_COUNT)).padStart(2, "0")}
            </span>
          </button>
        ))}
      </div>
      <div className="sequence-actions">
        {song.sequence[current]?.splitPattern ? (
          <label className="sequence-pattern-pick" title="This position plays a separate pattern on each channel - pick the current channel's">
            {CHANNELS[channel].short} pattern
            <select
              value={song.sequence[current].channels[channel]}
              onChange={(e) => {
                const id = Number(e.target.value);
                edit((s) => {
                  s.sequence[current].channels[channel] = id;
                });
              }}
            >
              {song.patterns.map((_, id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="sequence-pattern-pick" title="Which pattern plays at the selected position">
            pattern
            <select
              value={Math.floor((song.sequence[current]?.channels[0] ?? 0) / CHANNEL_COUNT)}
              onChange={(e) => {
                const block = Number(e.target.value);
                edit((s) => {
                  s.sequence[current] = createSequenceItem(block);
                });
              }}
            >
              {Array.from({ length: blocks }, (_, b) => (
                <option key={b} value={b}>
                  {String(b).padStart(2, "0")}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="icon-btn" title="Add a new empty pattern after this position" onClick={() => insertAfter((s) => createSequenceItem(addPatternBlock(s)))}>
          ＋
        </button>
        <button
          className="icon-btn"
          title="Copy this position's pattern into a new pattern after it"
          onClick={() =>
            insertAfter((s) => {
              const src = s.sequence[current];
              const block = addPatternBlock(s);
              for (let c = 0; c < CHANNEL_COUNT; c++) {
                s.patterns[block * CHANNEL_COUNT + c] = s.patterns[src.channels[c]].map((cell) => ({ ...cell }));
              }
              return createSequenceItem(block);
            })
          }
        >
          ⧉
        </button>
        <button
          className="icon-btn"
          title="Play this same pattern again after this position (edits show in both)"
          onClick={() => insertAfter((s) => ({ ...s.sequence[current], channels: [...s.sequence[current].channels] as [number, number, number, number] }))}
        >
          ↻
        </button>
        <button
          className="icon-btn"
          title="Move this position left"
          disabled={current <= 0}
          onClick={() => {
            edit((s) => {
              const [it] = s.sequence.splice(current, 1);
              s.sequence.splice(current - 1, 0, it);
            });
            go(current - 1);
          }}
        >
          ←
        </button>
        <button
          className="icon-btn"
          title="Move this position right"
          disabled={current >= song.sequence.length - 1}
          onClick={() => {
            edit((s) => {
              const [it] = s.sequence.splice(current, 1);
              s.sequence.splice(current + 1, 0, it);
            });
            go(current + 1);
          }}
        >
          →
        </button>
        <button
          className="icon-btn"
          title="Remove this position (its pattern is dropped when the song saves if nothing else uses it)"
          disabled={song.sequence.length <= 1}
          onClick={() => {
            edit((s) => {
              s.sequence.splice(current, 1);
            });
            go(Math.max(0, current - 1));
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
