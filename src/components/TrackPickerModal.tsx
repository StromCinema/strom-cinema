import React, { useEffect, useRef, useMemo } from 'react';
import { Play, X, Volume2, Subtitles } from 'lucide-react';
import { Movie, TrackInfo } from '../types';

interface TrackPickerModalProps {
  movie: Movie;
  tracks: TrackInfo;
  onPlay: (audioTrack: number | null, subtitleTrack: number | null) => void;
  onClose: () => void;
}

// ── Focus item descriptors ──────────────────────────────────────────────────
// Sections: audio tracks | subtitle tracks (Off + each sub) | Play Now | Skip
type FocusItem =
  | { kind: 'audio';    id: number }
  | { kind: 'sub';      id: number | null }  // null = Off
  | { kind: 'play' }
  | { kind: 'skip' };

export default function TrackPickerModal({ movie, tracks, onPlay, onClose }: TrackPickerModalProps) {
  const [selectedAudio, setSelectedAudio] = React.useState<number | null>(
    tracks.audioTracks.length > 0 ? tracks.audioTracks[0].id : null
  );
  const [selectedSub, setSelectedSub] = React.useState<number | null>(null);
  const selectedAudioRef = React.useRef(selectedAudio);
  const selectedSubRef   = React.useRef(selectedSub);
  React.useEffect(() => { selectedAudioRef.current = selectedAudio; }, [selectedAudio]);
  React.useEffect(() => { selectedSubRef.current   = selectedSub;   }, [selectedSub]);
  const [focusIdx, setFocusIdx] = React.useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const hasAudio = tracks.audioTracks.length > 1;
  const hasSubs  = tracks.subtitles.length > 0;

  // If no meaningful choices, fire immediately
  useEffect(() => {
    if (!hasAudio && !hasSubs) {
      onPlay(selectedAudio, null);
    }
  }, []);

  // Build flat nav list
  const navItems = useMemo<FocusItem[]>(() => {
    const items: FocusItem[] = [];
    if (hasAudio) tracks.audioTracks.forEach(t => items.push({ kind: 'audio', id: t.id }));
    if (hasSubs) {
      items.push({ kind: 'sub', id: null }); // Off
      tracks.subtitles.forEach(t => items.push({ kind: 'sub', id: t.id }));
    }
    items.push({ kind: 'play' });
    items.push({ kind: 'skip' });
    return items;
  }, [hasAudio, hasSubs, tracks]);

  // Index of the Play Now button in the flat nav list — used to auto-jump focus
  const playItemIdx = useMemo(
    () => navItems.findIndex(item => item.kind === 'play'),
    [navItems]
  );

  const selectSubAndJump = (id: number | null) => {
    setSelectedSub(id);
    setFocusIdx(playItemIdx);
  };

  // Sync DOM focus
  useEffect(() => {
    itemRefs.current[focusIdx]?.focus({ preventScroll: false });
  }, [focusIdx]);

  // Auto-focus on mount
  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  // D-pad / keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(prev => Math.min(prev + 1, navItems.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter': {
          e.preventDefault(); e.stopPropagation();
          const item = navItems[focusIdx];
          if (!item) break;
          if (item.kind === 'audio')  { setSelectedAudio(item.id); break; }
          if (item.kind === 'sub')    { setSelectedSub(item.id); setFocusIdx(playItemIdx); break; }
          if (item.kind === 'play')   { onPlay(selectedAudioRef.current, selectedSubRef.current); break; }
          if (item.kind === 'skip')   { onPlay(tracks.audioTracks[0]?.id ?? null, null); break; }
          break;
        }
        case 'Escape':
        case 'Backspace':
          e.preventDefault(); e.stopPropagation();
          onClose();
          break;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [focusIdx, navItems, selectedAudio, selectedSub, onPlay, onClose, tracks]);

  // Helper: is a given nav-list index currently d-pad focused?
  const isFocused = (idx: number) => focusIdx === idx;

  // Running index as we render items
  let idx = 0;

  const focusRing = 'ring-2 ring-orange-500/60 border-orange-500/60';
  const itemBase  = 'w-full flex items-center justify-between px-4 py-2.5 rounded-xl border text-left transition-all cursor-pointer focus:outline-none';

  return (
    <div className="fixed inset-0 z-[125] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative z-10 bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm shadow-2xl flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — fixed, never scrolls */}
        <div className="flex items-start justify-between p-6 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={movie.posterPath}
              alt={movie.title}
              className="w-10 h-14 object-cover rounded-lg border border-white/10 flex-shrink-0"
              referrerPolicy="no-referrer"
            />
            <div className="min-w-0">
              <h3 className="text-white font-bold text-sm truncate">{movie.title}</h3>
              <p className="text-zinc-400 text-[10px] font-mono mt-0.5">Select tracks before playing</p>
              <p className="text-zinc-600 text-[9px] font-mono mt-1 uppercase tracking-wider">▲ ▼ navigate · Enter select · Esc close</p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors cursor-pointer flex-shrink-0 ml-3 p-1 rounded-lg hover:bg-zinc-800">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable track list */}
        <div className="flex-1 overflow-y-auto px-6 pb-2 min-h-0 scrollbar-none">
          {/* Audio tracks */}
          {hasAudio && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Volume2 size={11} className="text-orange-400" />
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-orange-400">Audio</span>
              </div>
              <div className="space-y-1.5">
                {tracks.audioTracks.map(t => {
                  const i = idx++;
                  const active = selectedAudio === t.id;
                  return (
                    <button
                      key={t.id}
                      ref={el => { itemRefs.current[i] = el; }}
                      onClick={() => setSelectedAudio(t.id)}
                      onFocus={() => setFocusIdx(i)}
                      className={`${itemBase} ${
                        isFocused(i) ? `bg-orange-500/10 ${focusRing}` : active ? 'bg-orange-500/15 border-orange-500/50 text-white' : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 hover:border-zinc-600 text-zinc-300'
                      }`}
                    >
                      <div>
                        <span className="text-xs font-bold block">{t.title}</span>
                        <span className="text-[10px] font-mono text-zinc-500">{t.language} · {t.codec} · {t.channels}ch</span>
                      </div>
                      {active && <div className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Subtitle tracks */}
          {hasSubs && (
            <div className="mb-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Subtitles size={11} className="text-orange-400" />
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-orange-400">Subtitles</span>
              </div>
              <div className="space-y-1.5">
                {/* Off */}
                {(() => {
                  const i = idx++;
                  const active = selectedSub === null;
                  return (
                    <button
                      ref={el => { itemRefs.current[i] = el; }}
                      onClick={() => selectSubAndJump(null)}
                      onFocus={() => setFocusIdx(i)}
                      className={`${itemBase} ${
                        isFocused(i)
                          ? `bg-orange-500/10 ${focusRing}`
                          : active
                          ? 'bg-violet-500/20 border-violet-500/60 text-white'
                          : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 hover:border-zinc-600 text-zinc-300'
                      }`}
                    >
                      <span className="text-xs font-bold">Off</span>
                      {active && (
                        <span className="text-[9px] font-bold font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-violet-500 text-white flex-shrink-0">
                          Selected
                        </span>
                      )}
                    </button>
                  );
                })()}

                {tracks.subtitles.map(t => {
                  const i = idx++;
                  const active = selectedSub === t.id;
                  return (
                    <button
                      key={t.id}
                      ref={el => { itemRefs.current[i] = el; }}
                      onClick={() => selectSubAndJump(t.id)}
                      onFocus={() => setFocusIdx(i)}
                      className={`${itemBase} ${
                        isFocused(i)
                          ? `bg-orange-500/10 ${focusRing}`
                          : active
                          ? 'bg-violet-500/20 border-violet-500/60 text-white'
                          : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 hover:border-zinc-600 text-zinc-300'
                      }`}
                    >
                      <div>
                        <span className="text-xs font-bold block">{t.title}</span>
                        <span className="text-[10px] font-mono text-zinc-500">{t.language} · {t.codec}</span>
                      </div>
                      {active && (
                        <span className="text-[9px] font-bold font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-violet-500 text-white flex-shrink-0">
                          Selected
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer — always visible, never scrolls */}
        <div className="flex-shrink-0 px-6 pb-6 pt-3 border-t border-zinc-800">
          {/* Play Now */}
          {(() => {
            const i = idx++;
            return (
              <button
                ref={el => { itemRefs.current[i] = el; }}
                onClick={() => onPlay(selectedAudio, selectedSub)}
                onFocus={() => setFocusIdx(i)}
                className={`w-full flex items-center justify-center gap-2.5 px-6 py-3.5 bg-orange-500 hover:bg-orange-400 text-black font-black text-sm uppercase tracking-widest rounded-xl transition-all cursor-pointer active:scale-95 shadow-lg shadow-orange-500/20 focus:outline-none ${
                  isFocused(i) ? 'ring-4 ring-white ring-offset-2 ring-offset-zinc-900 scale-105' : ''
                }`}
              >
                <Play size={16} fill="currentColor" />
                Play Now
              </button>
            );
          })()}

          {/* Skip */}
          {(() => {
            const i = idx++;
            return (
              <button
                ref={el => { itemRefs.current[i] = el; }}
                onClick={() => onPlay(tracks.audioTracks[0]?.id ?? null, null)}
                onFocus={() => setFocusIdx(i)}
                className={`w-full mt-2.5 text-center text-[10px] font-mono transition-colors cursor-pointer uppercase tracking-wider focus:outline-none rounded-lg py-1 ${
                  isFocused(i) ? 'text-orange-400 ring-1 ring-orange-500/40' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                Skip — use defaults
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
