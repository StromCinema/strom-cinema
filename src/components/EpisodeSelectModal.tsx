import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, Film, ChevronDown, ChevronUp, Clock, Tv, CheckCircle } from 'lucide-react';
import { ParsedEpisode, formatEpisodeBadge } from '../lib/episodeUtils';
import { Movie } from '../types';

interface EpisodeSelectModalProps {
  /** The parent TV show Movie object (used for backdrop, title, metadata) */
  show: Movie;
  /** All detected episodes belonging to this show */
  episodes: ParsedEpisode[];
  /** Called when the user picks an episode to play */
  onPlayEpisode: (episode: ParsedEpisode, show: Movie) => void;
  /** Called to close this modal */
  onClose: () => void;
  /** Platform used for accent colour theming (mirrors rest of app) */
  targetPlatform?: 'windows' | 'android-tv' | 'tizen-tv';
}

/**
 * EpisodeSelectModal
 *
 * Opens over the existing movie card grid when a multi-episode TV show is
 * clicked. Preserves the app's existing dark cinematic aesthetic exactly —
 * same zinc palette, orange/cyan accents, border styles, and backdrop blur
 * as MovieDetailsModal. No new design language is introduced.
 */
export default function EpisodeSelectModal({
  show,
  episodes,
  onPlayEpisode,
  onClose,
  targetPlatform = 'windows',
}: EpisodeSelectModalProps) {
  const isTizen = targetPlatform === 'tizen-tv';
  const accentColor = isTizen ? 'cyan' : 'orange';

  // Group episodes by season for collapsible season sections
  const seasonMap = React.useMemo(() => {
    const map = new Map<number, ParsedEpisode[]>();
    for (const ep of episodes) {
      const s = ep.season > 0 ? ep.season : 0;
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(ep);
    }
    return map;
  }, [episodes]);

  const seasonNumbers = [...seasonMap.keys()].sort((a, b) => a - b);

  // Collapsed state per season (all expanded by default)
  const [collapsedSeasons, setCollapsedSeasons] = useState<Set<number>>(new Set());

  // D-pad focused episode index (flat across all seasons)
  const [focusedIdx, setFocusedIdx] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const flatEpisodes = React.useMemo(
    () => seasonNumbers.flatMap(s => seasonMap.get(s)!),
    [seasonNumbers, seasonMap]
  );

  // Sync DOM focus when navigating by keyboard
  useEffect(() => {
    itemRefs.current[focusedIdx]?.focus({ preventScroll: false });
    itemRefs.current[focusedIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedIdx]);

  // Keyboard / D-pad navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setFocusedIdx(prev => Math.min(prev + 1, flatEpisodes.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setFocusedIdx(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter': {
          e.preventDefault();
          e.stopPropagation();
          const ep = flatEpisodes[focusedIdx];
          if (ep) onPlayEpisode(ep, show);
          break;
        }
        case 'Escape':
        case 'Backspace':
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
        default:
          break;
      }
    };

    // Use capture phase so we intercept before any other listener
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [flatEpisodes, focusedIdx, onPlayEpisode, onClose, show]);

  const toggleSeason = (s: number) => {
    setCollapsedSeasons(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  // Accent class helpers matching the app's existing patterns
  const accentText = isTizen ? 'text-cyan-400' : 'text-orange-500';
  const accentBg = isTizen ? 'bg-cyan-400' : 'bg-orange-500';
  const accentBorder = isTizen ? 'border-cyan-500/30' : 'border-orange-500/30';
  const accentRing = isTizen
    ? 'ring-2 ring-cyan-400 ring-offset-1 ring-offset-zinc-950'
    : 'ring-2 ring-orange-500 ring-offset-1 ring-offset-zinc-950';
  const focusedRowBg = isTizen ? 'bg-cyan-500/10' : 'bg-orange-500/10';

  const badge = formatEpisodeBadge(episodes);

  // Flat index tracker as we render rows (used to assign refs)
  let flatIdx = 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-xl animate-in fade-in duration-300"
      onClick={onClose}
    >
      <div className="min-h-full flex items-center justify-center p-4">
      <div
        className="relative w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Backdrop header strip ── */}
        <div className="relative h-28 w-full overflow-hidden bg-zinc-950 flex-shrink-0">
          {show.backdropPath && (
            <>
              <div
                className="absolute inset-0 bg-cover bg-center scale-105"
                style={{
                  backgroundImage: `url(${show.backdropPath})`,
                  filter: 'brightness(0.28) contrast(1.1)',
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/30 to-transparent" />
            </>
          )}

          {/* Show title + episode count badge */}
          <div className="absolute bottom-3 left-4 z-10 flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <Tv size={12} className={accentText} />
              <span className={`text-[10px] font-mono tracking-widest font-bold uppercase ${accentText}`}>
                {badge}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight leading-none">
              {show.title}
            </h2>
          </div>

          {/* Close button — matches MovieDetailsModal exactly */}
          <button
            onClick={onClose}
            className="absolute top-2.5 right-2.5 p-1.5 bg-black/60 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-all cursor-pointer z-20"
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Poster + metadata row ── */}
        <div className="flex gap-4 px-4 pt-4 flex-shrink-0">
          {/* Poster thumbnail */}
          <div className="flex-shrink-0 w-20 aspect-[2/3] rounded-lg overflow-hidden border border-zinc-700/50 shadow-lg">
            <img
              src={show.posterPath}
              alt={show.title}
              className="w-full h-full object-cover brightness-105"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>

          {/* Metadata */}
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
            {/* Genre pills */}
            {show.genres?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {show.genres.slice(0, 3).map(g => (
                  <span key={g} className={`text-[9px] font-bold uppercase px-2 py-0.5 bg-zinc-900 border ${accentBorder} ${accentText} rounded-full`}>
                    {g}
                  </span>
                ))}
              </div>
            )}
            {/* Overview */}
            {show.overview && (
              <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-2">{show.overview}</p>
            )}
            {/* Keyboard hint */}
            <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">
              ▲ ▼ to navigate · Enter to play · Esc to close
            </p>
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="mx-4 mt-4 mb-0 h-px bg-zinc-800/60 flex-shrink-0" />

        {/* ── Episode list (scrollable) ── */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-none">
          {seasonNumbers.map(seasonNum => {
            const eps = seasonMap.get(seasonNum)!;
            const isCollapsed = collapsedSeasons.has(seasonNum);
            const seasonLabel = seasonNum === 0 ? 'Episodes' : `Season ${seasonNum}`;

            return (
              <div key={seasonNum}>
                {/* Season header — clickable to collapse */}
                {seasonNumbers.length > 1 || seasonNum === 0 ? (
                  <button
                    onClick={() => toggleSeason(seasonNum)}
                    className="w-full flex items-center justify-between px-2 py-1.5 text-left group cursor-pointer"
                  >
                    <span className={`text-[10px] font-mono font-bold uppercase tracking-widest ${accentText}`}>
                      {seasonLabel}
                      <span className="text-zinc-500 ml-2 font-normal">({eps.length} eps)</span>
                    </span>
                    {isCollapsed
                      ? <ChevronDown size={12} className="text-zinc-500 group-hover:text-white transition-colors" />
                      : <ChevronUp size={12} className="text-zinc-500 group-hover:text-white transition-colors" />
                    }
                  </button>
                ) : null}

                {/* Episode rows */}
                {!isCollapsed && (
                  <div className="space-y-1">
                    {eps.map(ep => {
                      const idx = flatIdx++;
                      const isFocused = focusedIdx === idx;

                      return (
                        <button
                          key={ep.id}
                          ref={el => { itemRefs.current[idx] = el; }}
                          onClick={() => onPlayEpisode(ep, show)}
                          onFocus={() => setFocusedIdx(idx)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all duration-150 text-left group focus:outline-none ${
                            isFocused
                              ? `${focusedRowBg} border-zinc-700 ${accentRing}`
                              : 'border-transparent hover:bg-zinc-900/60 hover:border-zinc-800'
                          }`}
                        >
                          {/* Episode number badge */}
                          <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-black font-mono border ${
                            isFocused
                              ? `${accentBg} text-black border-transparent`
                              : `bg-zinc-900 ${accentText} ${accentBorder}`
                          }`}>
                            {ep.season > 0
                              ? `${ep.season}×${String(ep.episode).padStart(2, '0')}`
                              : String(ep.episode).padStart(2, '0')
                            }
                          </div>

                          {/* Title + path */}
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-bold font-sans leading-tight truncate ${isFocused ? 'text-white' : 'text-zinc-200 group-hover:text-white'}`}>
                              {ep.title}
                            </p>
                            <p className="text-[9px] font-mono text-zinc-500 truncate mt-0.5">
                              {ep.filePath.split(/[/\\]/).pop()}
                            </p>
                          </div>

                          {/* Runtime (if present) */}
                          {ep.runtime ? (
                            <div className="flex-shrink-0 flex items-center gap-1 text-[9px] font-mono text-zinc-500">
                              <Clock size={9} />
                              <span>{ep.runtime}m</span>
                            </div>
                          ) : null}

                          {/* Play icon on right */}
                          <div className={`flex-shrink-0 transition-opacity ${isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}>
                            <Play size={13} className={accentText} fill="currentColor" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div className="px-4 py-3 border-t border-zinc-800/60 flex items-center justify-between flex-shrink-0">
          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">
            {episodes.length} episode{episodes.length !== 1 ? 's' : ''} detected
          </span>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white text-[10px] font-bold font-mono uppercase tracking-wider rounded-lg transition-all cursor-pointer"
          >
            <X size={10} /> Close
          </button>
        </div>
      </div>
      </div>
    </div>,
    document.body
  );
}
