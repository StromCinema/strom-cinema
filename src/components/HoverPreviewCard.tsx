import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Play, Tv } from 'lucide-react';
import { Movie } from '../types';
import type { TrackInfo } from '../types';
import { useActivePreview } from './ActivePreviewContext';
// NEW: episode helpers
import { parseEpisodesFromMovie, formatEpisodeBadge } from '../lib/episodeUtils';

interface HoverPreviewCardProps {
  key?: React.Key;
  id?: string;
  movie: Movie;
  isCardFocused: boolean;
  targetPlatform: 'windows' | 'android-tv' | 'tizen-tv';
  onClick: () => void;
  onPlayClick: () => void;
  onMouseEnter?: () => void;
  onTracksReady?: (movieId: string, tracks: TrackInfo) => void;
  /** When true the card fills its grid column instead of using fixed shelf widths */
  gridMode?: boolean;
}

export default function HoverPreviewCard({
  id,
  movie,
  isCardFocused,
  targetPlatform,
  onClick,
  onPlayClick,
  onMouseEnter,
  onTracksReady,
  gridMode = false,
}: HoverPreviewCardProps) {
  const { activeId, setActiveId } = useActivePreview();
  const [isHovered, setIsHovered] = useState(false);
  const [isHtmlFocused, setIsHtmlFocused] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [tapState, setTapState] = useState<'none' | 'previewed'>('none');
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Tracks whether we've already prefetched for this card instance so we don't
  // fire the fetch repeatedly on re-hover.
  const tracksFetchedRef = useRef(false);

  const isFocused = isCardFocused || isHtmlFocused;

  // Use title as discriminator — movie.id and localFilePath can collide across grouped TV shows
  const cardId = `hover-card-${movie.title}-${movie.id || movie.trackerItemId || movie.localFilePath}`;
  const isActive = activeId === cardId;

  // ── NEW: detect multi-episode TV show ──────────────────────────────────────
  // episodePaths can be a dedicated field on Movie, or we fall back to the
  // primary localFilePath only. Both branches handled gracefully.
  const episodePaths: string[] = (movie as any).episodePaths ?? [];
  const episodes = React.useMemo(
    () => parseEpisodesFromMovie(movie.localFilePath ?? '', episodePaths),
    [movie.localFilePath, episodePaths]
  );
  const isMultiEpisode = episodes.length > 1;
  const episodeBadge = isMultiEpisode ? formatEpisodeBadge(episodes) : null;
  // ──────────────────────────────────────────────────────────────────────────

  // ── Track prefetch: fire once when this card becomes active (local only) ──
  useEffect(() => {
    if (!isActive) return;
    if (tracksFetchedRef.current) return;
    if (!movie.isLocal || !movie.localFilePath) return;
    if (!onTracksReady) return;

    tracksFetchedRef.current = true;
    const host = localStorage.getItem('plexus_companion_host') || 'http://localhost:5000';
    fetch(`${host}/api/media/tracks?path=${encodeURIComponent(movie.localFilePath)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) onTracksReady(movie.id, data as TrackInfo);
      })
      .catch(() => { /* non-fatal — track picker simply won't show */ });
  }, [isActive, movie.isLocal, movie.localFilePath, movie.id, onTracksReady]);
  // ──────────────────────────────────────────────────────────────────────────

  // Track touch screen vs desktop device
  useEffect(() => {
    const checkTouch = () => {
      setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0);
    };
    checkTouch();
  }, []);

  // Unified Hover & Focus intent manager
  useEffect(() => {
    if (isFocused) {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      setActiveId(cardId);
    } else if (isHovered && !isMobile) {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      hoverTimeoutRef.current = setTimeout(() => {
        setActiveId(cardId);
      }, 250);
    } else {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      hoverTimeoutRef.current = setTimeout(() => {
        if (!isHovered && !isFocused && activeId === cardId) {
          setActiveId(null);
        }
      }, 200);
    }

    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, [isHovered, isFocused, cardId, activeId, setActiveId, isMobile]);

  const handleMouseEnter = () => {
    if (isMobile) return;
    setIsHovered(true);
    if (onMouseEnter) {
      onMouseEnter();
    }
  };

  const handleMouseLeave = () => {
    if (isMobile) return;
    setIsHovered(false);
  };

  const handleTouchStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isMobile) return;
    e.preventDefault();

    if (tapState === 'none' && activeId !== cardId) {
      setActiveId(cardId);
      setTapState('previewed');
    } else if (tapState === 'previewed' && isActive) {
      onClick();
      setTapState('none');
      setActiveId(null);
    }
  };

  useEffect(() => {
    if (activeId !== cardId) {
      setTapState('none');
    }
  }, [activeId, cardId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onClick();
    } else if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      setActiveId(null);
      (e.currentTarget as HTMLElement).blur();
    }
  };

  const accentRing = targetPlatform === 'tizen-tv'
    ? 'ring-4 ring-cyan-400 border-cyan-400/50 shadow-[0_0_25px_rgba(34,211,238,0.5)] ring-offset-2 ring-offset-zinc-950 scale-105 z-50'
    : 'ring-4 ring-orange-500 border-orange-500/50 shadow-[0_0_25px_rgba(249,115,22,0.5)] ring-offset-2 ring-offset-zinc-950 scale-105 z-50';

  // Badge accent colours reuse existing palette
  const badgeBg = targetPlatform === 'tizen-tv' ? 'bg-cyan-500' : 'bg-orange-500';

  return (
    <motion.div
      layout
      transition={{ type: 'spring', stiffness: 280, damping: 28 }}
      data-dpad-focused={isCardFocused ? 'true' : undefined}
      className={`relative flex-shrink-0 select-none aspect-[2/3] ${isActive ? 'z-50' : 'z-10'} ${
        gridMode
          ? 'w-full'
          : targetPlatform === 'android-tv'
            ? 'w-[8vw] min-w-[100px] max-w-[140px]'
            : 'w-[13vw] min-w-[110px] max-w-[180px]'
      }`}
    >
      <motion.div
        id={id}
        layout
        tabIndex={0}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={() => setIsHtmlFocused(true)}
        onBlur={() => setIsHtmlFocused(false)}
        onKeyDown={handleKeyDown}
        onClick={isMobile ? handleTouchStart : onClick}
        transition={{ type: 'spring', stiffness: 280, damping: 28 }}
        className={`group absolute inset-0 w-full h-full overflow-hidden rounded-xl bg-zinc-950 border cursor-pointer focus:outline-none ${
          isActive
            ? 'shadow-[0_32px_64px_rgba(0,0,0,0.9)] border-zinc-700/60'
            : 'border-white/5 opacity-80 hover:opacity-100'
        } ${isCardFocused ? accentRing : ''}`}
      >
        {/* Poster — always visible */}
        <img
          src={movie.posterPath}
          alt={movie.title}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          loading="lazy"
          referrerPolicy="no-referrer"
        />

        {/* Gradient backplate */}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/25 to-transparent z-10 pointer-events-none" />

        {/* ── NEW: Multi-episode badge (top-left corner) ─────────────────── */}
        {episodeBadge && (
          <div className="absolute top-2 left-2 z-30 pointer-events-none">
            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md ${badgeBg} shadow-lg`}>
              <Tv size={8} className="text-black flex-shrink-0" />
              <span className="text-[8px] font-black font-mono text-black uppercase tracking-wide leading-none">
                {episodeBadge}
              </span>
            </div>
          </div>
        )}
        {/* ─────────────────────────────────────────────────────────────────── */}

        {/* Idle meta (title only) */}
        <div
          className="absolute inset-0 p-3 flex flex-col justify-end pointer-events-none z-20 transition-opacity duration-200"
          style={{ opacity: isActive ? 0 : 1 }}
        >
          <span className="text-[10px] sm:text-[11px] font-bold text-white truncate max-w-full leading-tight">
            {movie.title}
          </span>
        </div>

        {/* Active meta (full info + buttons) */}
        <div
          className="absolute inset-x-0 bottom-0 p-3 sm:p-4 z-30 flex flex-col justify-end text-left transition-all duration-200 pointer-events-none"
          style={{ opacity: isActive ? 1 : 0, transform: isActive ? 'translateY(0)' : 'translateY(8px)', pointerEvents: isActive ? 'auto' : 'none' }}
        >
          <h3 className="text-xs sm:text-sm font-black text-white leading-tight font-sans tracking-tight mb-2 truncate">
            {movie.title}
          </h3>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onPlayClick}
              className={`flex items-center justify-center gap-1 px-3 py-1 text-[9px] font-bold font-mono uppercase tracking-wider text-white rounded-lg transition-transform hover:scale-105 active:scale-95 shadow cursor-pointer ${
                targetPlatform === 'tizen-tv' ? 'bg-cyan-500 hover:bg-cyan-600' : 'bg-orange-500 hover:bg-orange-600'
              }`}
            >
              <Play size={9} fill="currentColor" />
              {isMultiEpisode ? 'Episodes' : 'Play'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
