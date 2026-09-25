import { useEffect, useState } from "react";

import { useMusicStore } from "../../music/musicStore";
import { player } from "../../music/player";
import { CHANNELS, WAVE_COUNT, type InstrumentType } from "../../music/song";
import { useProjectStore } from "../../state/projectStore";
import PopoverMenu from "../common/PopoverMenu";
import { INSTRUMENT_COLORS } from "./PianoRoll";
import Icon from "../common/Icon";

interface Props {
  onImportMidi: () => void;
}

/** Left column: the project's songs, then (for the open song) its
 * channels, instruments and waves. */
export default function MusicNavigator({ onImportMidi }: Props) {
  return (
    <div className="music-nav">
      <SongList onImportMidi={onImportMidi} />
      <ChannelList />
      <InstrumentList />
      <SoundList />
    </div>
  );
}

function SongList({ onImportMidi }: Props) {
  const project = useProjectStore((s) => s.project);
  const assets = useProjectStore((s) => s.assets);
  const refreshAssets = useProjectStore((s) => s.refreshAssets);
  const songName = useMusicStore((s) => s.songName);
  const saveState = useMusicStore((s) => s.saveState);
  const openSong = useMusicStore((s) => s.openSong);
  const createSong = useMusicStore((s) => s.createSong);
  const renameSong = useMusicStore((s) => s.renameSong);
  const deleteSong = useMusicStore((s) => s.deleteSong);
  const [menu, setMenu] = useState<{ x: number; y: number; name: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [addMenu, setAddMenu] = useState<HTMLElement | null>(null);
  const songs = assets?.music ?? [];

  // Open the first song when the section opens with nothing selected.
  useEffect(() => {
    if (!songName && project && songs.length) void openSong(project.rootPath, songs[0].name);
  }, [songName, project, songs, openSong]);

  const usedBy = (name: string) => (project?.scenes ?? []).filter((s) => s.data.music === name).length;

  return (
    <section className="music-nav-section music-nav-songs">
      <header className="music-nav-head">
        <span>Songs</span>
        <button className="icon-btn" title="New song, import a MIDI file, or import a .uge" onClick={(e) => setAddMenu(e.currentTarget)}>
          +
        </button>
      </header>
      <div className="music-nav-list">
        {songs.length === 0 && <div className="music-nav-empty">No songs yet. Use + to make one or import a MIDI file.</div>}
        {songs.map((t) =>
          renaming === t.name ? (
            <input
              key={t.name}
              className="music-nav-rename"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setRenaming(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setRenaming(null);
                  void renameSong(draft);
                } else if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <button
              key={t.name}
              className={`music-nav-item${t.name === songName ? " music-nav-item-on" : ""}`}
              onClick={() => project && t.name !== songName && void openSong(project.rootPath, t.name)}
              onDoubleClick={() => {
                if (t.name !== songName) return;
                setDraft(t.name);
                setRenaming(t.name);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (project && t.name !== songName) void openSong(project.rootPath, t.name);
                setMenu({ x: e.clientX, y: e.clientY, name: t.name });
              }}
              title={`${t.fileName}${usedBy(t.name) ? ` - music for ${usedBy(t.name)} scene(s)` : ""}`}
            >
              <span className="music-nav-icon">♪</span>
              <span className="music-nav-name">{t.name}</span>
              {t.name === songName && saveState !== "saved" && (
                <span className={`music-nav-dirty${saveState === "error" ? " music-nav-dirty-error" : ""}`} title={saveState === "error" ? "Couldn't save" : "Saving…"}>
                  ●
                </span>
              )}
            </button>
          ),
        )}
      </div>
      {addMenu && (
        <PopoverMenu
          anchor={addMenu}
          onClose={() => setAddMenu(null)}
          items={[
            { label: "New song", onClick: () => void createSong("song") },
            { label: "Import MIDI file…", onClick: onImportMidi },
            {
              label: "Import .uge song…",
              onClick: async () => {
                if (!project) return;
                const r = await window.api.importAssets({ rootPath: project.rootPath, kind: "music" });
                if (r.ok && r.value) await refreshAssets();
              },
            },
          ]}
        />
      )}
      {menu && (
        <PopoverMenu
          anchor={menu}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Rename",
              onClick: () => {
                setDraft(menu.name);
                setRenaming(menu.name);
              },
            },
            {
              label: "Duplicate",
              onClick: () => {
                const song = useMusicStore.getState().song;
                if (song) void createSong(`${menu.name}_copy`, song);
              },
            },
            {
              label: "Show in folder",
              onClick: () => project && void window.api.revealInFolder({ rootPath: project.rootPath, relPath: `assets/music/${menu.name}.uge` }),
            },
            "separator",
            {
              label: "Delete",
              danger: true,
              onClick: () => {
                const n = usedBy(menu.name);
                const warn = n ? ` ${n} scene(s) use it as their music and will fail to build until changed.` : "";
                if (window.confirm(`Delete ${menu.name}.uge?${warn} This can't be undone.`)) void deleteSong();
              },
            },
          ]}
        />
      )}
    </section>
  );
}

function ChannelList() {
  const song = useMusicStore((s) => s.song);
  const channel = useMusicStore((s) => s.channel);
  const muted = useMusicStore((s) => s.muted);
  const setChannel = useMusicStore((s) => s.setChannel);
  const toggleMute = useMusicStore((s) => s.toggleMute);
  const showOther = useMusicStore((s) => s.showOtherChannels);
  const setShowOther = useMusicStore((s) => s.setShowOtherChannels);
  const [active, setActive] = useState([false, false, false, false]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const a = player.playing ? player.channelActivity : [false, false, false, false];
      setActive((prev) => (prev.every((v, i) => v === a[i]) ? prev : [...a]));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!song) return null;
  return (
    <section className="music-nav-section">
      <header className="music-nav-head">
        <span>Channels</span>
        <label className="music-nav-check" title="Show the other channels' notes faintly behind the one you're editing">
          <input type="checkbox" checked={showOther} onChange={(e) => setShowOther(e.target.checked)} />
          others
        </label>
      </header>
      {CHANNELS.map((c) => (
        <div key={c.index} className={`music-nav-item music-nav-channel${c.index === channel ? " music-nav-item-on" : ""}`} onClick={() => setChannel(c.index)}>
          <span className={`music-nav-led${active[c.index] && !muted[c.index] ? " music-nav-led-on" : ""}`} />
          <span className="music-nav-name">
            {c.index + 1}. {c.name}
          </span>
          <button
            className={`music-nav-mute${muted[c.index] ? " music-nav-mute-on" : ""}`}
            title={muted[c.index] ? "Unmute channel (editor only)" : "Mute channel (editor only)"}
            onClick={(e) => {
              e.stopPropagation();
              toggleMute(c.index);
            }}
          >
            <Icon name={muted[c.index] ? "mute" : "sound"} />
          </button>
        </div>
      ))}
    </section>
  );
}

const TYPE_LABEL: Record<InstrumentType, string> = { duty: "Duty", wave: "Wave", noise: "Noise" };

function InstrumentList() {
  const song = useMusicStore((s) => s.song);
  const channel = useMusicStore((s) => s.channel);
  const instrument = useMusicStore((s) => s.instrument);
  const inspect = useMusicStore((s) => s.inspect);
  const setInstrument = useMusicStore((s) => s.setInstrument);
  const setInspect = useMusicStore((s) => s.setInspect);
  const setChannel = useMusicStore((s) => s.setChannel);
  const [open, setOpen] = useState<Record<string, boolean>>({ duty: true, wave: true, noise: true, waves: false });
  if (!song) return null;
  const channelType = CHANNELS[channel].type;

  const lists: [InstrumentType, { name: string }[]][] = [
    ["duty", song.dutyInstruments],
    ["wave", song.waveInstruments],
    ["noise", song.noiseInstruments],
  ];

  return (
    <section className="music-nav-section music-nav-instruments">
      <header className="music-nav-head">
        <span>Instruments</span>
      </header>
      <div className="music-nav-list">
        {lists.map(([type, list]) => (
          <div key={type}>
            <button className="music-nav-group" onClick={() => setOpen({ ...open, [type]: !open[type] })}>
              {open[type] ? "▾" : "▸"} {TYPE_LABEL[type]}
            </button>
            {open[type] &&
              list.map((ins, i) => {
                const isInspected = inspect.kind === "instrument" && inspect.type === type && inspect.index === i;
                const isCurrent = instrument[type] === i;
                return (
                  <button
                    key={i}
                    className={`music-nav-item music-nav-instrument${isInspected ? " music-nav-item-on" : ""}`}
                    onClick={() => {
                      setInstrument(type, i);
                      setInspect({ kind: "instrument", type, index: i });
                      if (type !== channelType) setChannel(type === "duty" ? 0 : type === "wave" ? 2 : 3);
                    }}
                    title={isCurrent ? "New notes use this instrument" : "Click to edit it and use it for new notes"}
                  >
                    <span className="music-nav-swatch" style={{ background: INSTRUMENT_COLORS[i] }} />
                    <span className="music-nav-num">{String(i + 1).padStart(2, "0")}</span>
                    <span className="music-nav-name">{ins.name || `${TYPE_LABEL[type]} ${i + 1}`}</span>
                    {isCurrent && <span className="music-nav-current">●</span>}
                  </button>
                );
              })}
          </div>
        ))}
        <button className="music-nav-group" onClick={() => setOpen({ ...open, waves: !open.waves })}>
          {open.waves ? "▾" : "▸"} Waves
        </button>
        {open.waves &&
          Array.from({ length: WAVE_COUNT }, (_, i) => (
            <button
              key={i}
              className={`music-nav-item${inspect.kind === "wave" && inspect.index === i ? " music-nav-item-on" : ""}`}
              onClick={() => setInspect({ kind: "wave", index: i })}
            >
              <WaveThumb samples={song.waves[i]} />
              <span className="music-nav-name">Wave {i}</span>
            </button>
          ))}
      </div>
    </section>
  );
}

export function WaveThumb({ samples }: { samples: Uint8Array | undefined }) {
  const pts = Array.from({ length: 32 }, (_, i) => `${i},${15 - (samples?.[i] ?? 0)}`).join(" ");
  return (
    <svg className="music-wave-thumb" viewBox="0 0 31 15" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** WAV sound effects (assets/sounds), played with the Play Sound event. */
function SoundList() {
  const project = useProjectStore((s) => s.project);
  const assets = useProjectStore((s) => s.assets);
  const refreshAssets = useProjectStore((s) => s.refreshAssets);
  const [playing, setPlaying] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; relPath: string } | null>(null);
  const sounds = assets?.sounds ?? [];

  const preview = async (relPath: string) => {
    if (!project) return;
    const r = await window.api.readAsset({ rootPath: project.rootPath, relPath });
    if (!r.ok) return;
    const audio = new Audio(r.value.dataUrl);
    setPlaying(relPath);
    audio.onended = () => setPlaying((p) => (p === relPath ? null : p));
    void audio.play();
  };

  return (
    <section className="music-nav-section">
      <header className="music-nav-head">
        <span>Sound effects</span>
        <button
          className="icon-btn"
          title="Import WAV files"
          onClick={async () => {
            if (!project) return;
            const r = await window.api.importAssets({ rootPath: project.rootPath, kind: "sounds" });
            if (r.ok && r.value) await refreshAssets();
          }}
        >
          +
        </button>
      </header>
      <div className="music-nav-list">
        {sounds.length === 0 && (
          <div className="music-nav-empty">
            No sounds yet. Use + to add WAV files, then play them with the Play Sound event. They play on the GBA's two digital channels,
            over the music, as 16 kHz 8-bit mono (about 16 KB per second).
          </div>
        )}
        {sounds.map((a) => (
          <button
            key={a.relPath}
            className="music-nav-item"
            title={`${a.fileName} - click to listen`}
            onClick={() => void preview(a.relPath)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, relPath: a.relPath });
            }}
          >
            <span className="music-nav-icon">{playing === a.relPath ? "▶" : "~"}</span>
            <span className="music-nav-name">{a.name}</span>
          </button>
        ))}
      </div>
      {menu && (
        <PopoverMenu
          anchor={menu}
          onClose={() => setMenu(null)}
          items={[
            { label: "Listen", onClick: () => void preview(menu.relPath) },
            {
              label: "Show in folder",
              onClick: () => project && void window.api.revealInFolder({ rootPath: project.rootPath, relPath: menu.relPath }),
            },
          ]}
        />
      )}
    </section>
  );
}
