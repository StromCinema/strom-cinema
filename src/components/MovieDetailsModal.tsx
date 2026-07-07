import React from 'react';
import { Play, X, Star, Video, Film, Loader, Tv, Clock, SkipForward, User, Calendar, Timer, ChevronRight, Info, Volume2, Subtitles, Pencil } from 'lucide-react';
import { Movie, TrackInfo, PlaybackSession } from '../types';
import { getMovieDetails, getTvDetails } from '../lib/tmdb';
import { parseEpisodesFromMovie, formatEpisodeBadge, ParsedEpisode } from '../lib/episodeUtils';
import EditMovieModal, { applyOverrides } from './EditMovieModal';

interface MovieDetailsModalProps {
  movie: Movie;
  prefetchedTracks: TrackInfo | null;
  playbackSession: PlaybackSession | null;
  onPlayClick: (movie: Movie, startTime: number, audioTrack: number | null, subtitleTrack: number | null) => void;
  onPlayEpisode?: (episode: ParsedEpisode, show: Movie) => void;
  onClose: () => void;
  onMovieUpdate?: (updated: Movie) => void;
  isFocused?: boolean;
}

function getYouTubeEmbedUrl(url?: string): string | null {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  if (match && match[2].length === 11) {
    return `https://www.youtube.com/embed/${match[2]}?autoplay=1&mute=0&rel=0&enablejsapi=1&playsinline=1`;
  }
  return null;
}

function formatRuntime(minutes?: number): string {
  if (!minutes || minutes === 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function MovieDetailsModal({
  movie,
  prefetchedTracks,
  playbackSession,
  onPlayClick,
  onPlayEpisode,
  onClose,
  onMovieUpdate,
  isFocused = false,
}: MovieDetailsModalProps) {
  const [enrichedMovie, setEnrichedMovie] = React.useState<Movie>(() => applyOverrides(movie));
  const [showEditModal, setShowEditModal] = React.useState(false);
  const [isPlayingTrailer, setIsPlayingTrailer] = React.useState(false);
  const [isFetchingDetails, setIsFetchingDetails] = React.useState(false);
  // Track selection — local state, passed to onPlayClick at the moment Play is clicked.
  // Keeping these local (not lifted to App) is intentional: it avoids stale-prop
  // issues caused by parent re-renders between the user picking a track and clicking Play.
  const [selectedAudio, setSelectedAudio] = React.useState<number | null>(null);
  const [showAudioPicker, setShowAudioPicker] = React.useState(false);
  const [showEpisodeSheet, setShowEpisodeSheet] = React.useState(false);
  const [sheetFocusIdx, setSheetFocusIdx] = React.useState(0);


  // Use prefetched tracks if available, otherwise fetch on modal open.
  // Self-sufficient — does not depend on HoverPreviewCard having prefetched first.
  const [localTracks, setLocalTracks] = React.useState<TrackInfo | null>(prefetchedTracks);
  const tracksFetchedRef = React.useRef(false);
  React.useEffect(() => {
    if (tracksFetchedRef.current) return;  // fetch once only — never clobber user's selection
    if (prefetchedTracks) { setLocalTracks(prefetchedTracks); tracksFetchedRef.current = true; return; }
    if (!movie.isLocal || !movie.localFilePath) return;
    tracksFetchedRef.current = true;
    const host = localStorage.getItem('plexus_companion_host') || 'http://localhost:5000';
    fetch(`${host}/api/media/tracks?path=${encodeURIComponent(movie.localFilePath)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setLocalTracks(data as TrackInfo); })
      .catch(() => {});
  }, [movie.localFilePath, movie.isLocal, prefetchedTracks]);
  // Focus order: Play, [Resume], Trailer, [Audio], [Subtitles], Close, [episodes...]
  // Indices are computed dynamically based on which optional buttons are present.
  const [modalFocusIdx, setModalFocusIdx] = React.useState(0);
  // When a picker (audio/sub) is open, this tracks which picker item is focused (0=Off/first, 1,2...=tracks). -1=no item focused.
  const [pickerFocusIdx, setPickerFocusIdx] = React.useState<number>(-1);

  const episodePaths: string[] = (movie as any).episodePaths ?? [];
  const episodes = React.useMemo(
    () => parseEpisodesFromMovie(movie.localFilePath ?? '', episodePaths),
    [movie.localFilePath, episodePaths]
  );
  const isMultiEpisode = episodes.length > 1;
  const episodeBadge = isMultiEpisode ? formatEpisodeBadge(episodes) : null;
  const hasResume = !!(playbackSession && playbackSession.currentTime > 30);

  // Derived focus indices — recomputed whenever optional buttons appear/disappear
  const trailerIdx      = hasResume ? 2 : 1;
  const hasAudioBtn     = (localTracks?.audioTracks?.length ?? 0) > 1;
  const audioIdx        = hasAudioBtn ? trailerIdx + 1 : -1;
  const subIdx          = -1; // subtitle picker removed — ExoPlayer handles subs
  const episodesBtnIdx  = isMultiEpisode ? trailerIdx + (hasAudioBtn ? 1 : 0) + 1 : -1;
  const closeIdx        = trailerIdx + (hasAudioBtn ? 1 : 0) + (isMultiEpisode ? 1 : 0) + 1;
  // Focus order: Play, [Resume], Trailer, [Audio], [Episodes], Close
  const totalFocusItems = closeIdx + 1;
  const episodeRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  React.useEffect(() => {
    if (showEpisodeSheet) {
      episodeRefs.current[sheetFocusIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [sheetFocusIdx, showEpisodeSheet]);

  const embedUrl = getYouTubeEmbedUrl(enrichedMovie.trailerUrl);

  const resolveTmdbId = React.useCallback(async (apiKey: string): Promise<{ id: string; mediaType: 'movie' | 'tv' } | null> => {
    // If already a numeric TMDB id, guess media type from episode detection
    if (/^\d+$/.test(movie.id)) return { id: movie.id, mediaType: isMultiEpisode ? 'tv' : 'movie' };
    const isV4 = apiKey.trim().startsWith('eyJ');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (isV4) headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    const year = movie.releaseDate?.split('-')[0];
    const params = new URLSearchParams({ query: movie.title });
    if (!isV4) params.set('api_key', apiKey.trim());
    try {
      const [movieRes, tvRes] = await Promise.all([
        fetch(`https://api.themoviedb.org/3/search/movie?${params}`, { headers }),
        fetch(`https://api.themoviedb.org/3/search/tv?${params}`, { headers }),
      ]);

      const bestHit = (results: any[]) => {
        if (!results?.length) return null;
        if (year) {
          const yearMatch = results.find((r: any) =>
            (r.release_date || r.first_air_date || '').startsWith(year)
          );
          if (yearMatch) return yearMatch;
        }
        const titleLower = movie.title.toLowerCase();
        const exact = results.find((r: any) =>
          (r.title || r.name || '').toLowerCase() === titleLower
        );
        if (exact) return exact;
        const first = results[0];
        const firstName = (first?.title || first?.name || '').toLowerCase();
        const minLen = Math.min(titleLower.length, firstName.length);
        const prefixLen = Math.ceil(minLen * 0.5);
        if (prefixLen >= 4 && (firstName.startsWith(titleLower.slice(0, prefixLen)) || titleLower.startsWith(firstName.slice(0, prefixLen)))) {
          return first;
        }
        return null;
      };

      const movieHit = movieRes.ok ? bestHit((await movieRes.json()).results || []) : null;
      const tvHit    = tvRes.ok   ? bestHit((await tvRes.json()).results   || []) : null;

      // Prefer TV when episodes are detected, or when only TV returned a hit
      if (isMultiEpisode && tvHit) return { id: String(tvHit.id), mediaType: 'tv' };
      if (movieHit) return { id: String(movieHit.id), mediaType: 'movie' };
      if (tvHit)    return { id: String(tvHit.id),    mediaType: 'tv' };
      return null;
    } catch { return null; }
  }, [movie.id, movie.title, isMultiEpisode]);

  const fetchTMDBDetails = React.useCallback((): Promise<Movie | null> => {
    const tmdbRaw = localStorage.getItem('plexus_tmdb_settings');
    const apiKey = tmdbRaw ? JSON.parse(tmdbRaw)?.apiKey : null;
    if (!apiKey) return Promise.resolve(null);
    setIsFetchingDetails(true);
    return resolveTmdbId(apiKey)
      .then((result) => {
        if (!result) return null;
        return result.mediaType === 'tv'
          ? getTvDetails(result.id, apiKey)
          : getMovieDetails(result.id, apiKey);
      })
      .then((details) => details ?? null)
      .catch(() => null)
      .finally(() => setIsFetchingDetails(false));
  }, [movie.id, movie.title, resolveTmdbId]);

  React.useEffect(() => {
    // Reset to the correctly-enriched movie prop — all metadata is already correct from App.tsx
    setEnrichedMovie(movie);
    setIsPlayingTrailer(false);
    // Silently fetch trailer URL in the background — don't show loading spinner
    const tmdbRaw = localStorage.getItem('plexus_tmdb_settings');
    const apiKey = tmdbRaw ? JSON.parse(tmdbRaw)?.apiKey : null;
    if (!apiKey) return;
    resolveTmdbId(apiKey).then((result) => {
      if (!result) return null;
      return result.mediaType === 'tv'
        ? getTvDetails(result.id, apiKey)
        : getMovieDetails(result.id, apiKey);
    }).then((details) => {
      if (details?.trailerUrl) {
        setEnrichedMovie(prev => ({ ...prev, trailerUrl: details.trailerUrl }));
      }
    }).catch(() => {});
  }, [movie.id]);

  const handleTrailerClick = async () => {
    if (isPlayingTrailer) { setIsPlayingTrailer(false); return; }
    if (embedUrl) { setIsPlayingTrailer(true); return; }
    const details = await fetchTMDBDetails();
    if (details?.trailerUrl && getYouTubeEmbedUrl(details.trailerUrl)) {
      setEnrichedMovie(prev => ({ ...prev, trailerUrl: details.trailerUrl }));
      setIsPlayingTrailer(true);
    }
  };

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isPlayingTrailer) {
        if (e.key === 'Escape' || e.key === 'Backspace') {
          e.preventDefault(); e.stopPropagation();
          setIsPlayingTrailer(false);
        }
        return;
      }

      // -- EPISODE SHEET NAVIGATION
      if (showEpisodeSheet) {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault(); e.stopPropagation();
            setSheetFocusIdx(prev => Math.min(prev + 1, episodes.length - 1));
            return;
          case 'ArrowUp':
            e.preventDefault(); e.stopPropagation();
            if (sheetFocusIdx === 0) { setShowEpisodeSheet(false); }
            else { setSheetFocusIdx(prev => prev - 1); }
            return;
          case 'Enter': {
            e.preventDefault(); e.stopPropagation();
            const ep = episodes[sheetFocusIdx];
            if (ep && onPlayEpisode) { onPlayEpisode(ep, enrichedMovie); setShowEpisodeSheet(false); }
            return;
          }
          case 'Escape': case 'Backspace':
            e.preventDefault(); e.stopPropagation();
            setShowEpisodeSheet(false);
            return;
          default: return;
        }
      }

      // ── PICKER NAVIGATION MODE ──────────────────────────────────────────────
      // When audio or subtitle picker is expanded, arrow keys navigate inside it.
      const pickerIsOpen = showAudioPicker;
      if (pickerIsOpen) {
        const pickerItems = localTracks?.audioTracks ?? [];
        const pickerLen = pickerItems.length;

        switch (e.key) {
          case 'ArrowDown': case 'ArrowRight':
            e.preventDefault(); e.stopPropagation();
            setPickerFocusIdx(prev => Math.min(prev + 1, pickerLen - 1));
            return;
          case 'ArrowUp': case 'ArrowLeft':
            e.preventDefault(); e.stopPropagation();
            setPickerFocusIdx(prev => {
              if (prev <= 0) {
                // Back out to the top-level button row
                setShowAudioPicker(false); setPickerFocusIdx(-1);
                return -1;
              }
              return prev - 1;
            });
            return;
          case 'Enter': {
            e.preventDefault(); e.stopPropagation();
            if (pickerFocusIdx < 0) return;
             else {
              const item = pickerItems[pickerFocusIdx] as any;
              setSelectedAudio(item.id);
              setShowAudioPicker(false);
            }
            setPickerFocusIdx(-1);
            return;
          }
          case 'Escape': case 'Backspace':
            e.preventDefault(); e.stopPropagation();
            setShowAudioPicker(false); setPickerFocusIdx(-1);
            return;
          default: return;
        }
      }
      // ── NORMAL MODAL NAVIGATION ─────────────────────────────────────────────
      switch (e.key) {
        case 'Escape': case 'Backspace':
          e.preventDefault(); e.stopPropagation(); onClose(); break;
        case 'ArrowUp': case 'ArrowLeft':
          e.preventDefault(); e.stopPropagation();
          setModalFocusIdx(prev => Math.max(0, prev - 1)); break;
        case 'ArrowDown': case 'ArrowRight':
          e.preventDefault(); e.stopPropagation();
          setModalFocusIdx(prev => Math.min(totalFocusItems - 1, prev + 1)); break;
        case 'Enter':
          e.preventDefault(); e.stopPropagation();
          setModalFocusIdx(prev => {
            if (prev === 0) onPlayClick(movie, 0, selectedAudio, null);
            else if (hasResume && prev === 1) onPlayClick(movie, playbackSession!.currentTime, selectedAudio, null);
            else if (prev === trailerIdx) handleTrailerClick();
            else if (audioIdx !== -1 && prev === audioIdx) {
              setShowAudioPicker(p => !p); setPickerFocusIdx(0);
            }
            else if (episodesBtnIdx !== -1 && prev === episodesBtnIdx) {
              setShowEpisodeSheet(true); setSheetFocusIdx(0);
            }
            else if (prev === closeIdx) onClose();
            return prev;
          }); break;
        default: break;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose, onPlayClick, enrichedMovie, modalFocusIdx, isPlayingTrailer, totalFocusItems, episodes, isMultiEpisode, onPlayEpisode, hasResume, playbackSession, selectedAudio, trailerIdx, audioIdx, episodesBtnIdx, closeIdx, showAudioPicker, pickerFocusIdx, localTracks, showEpisodeSheet, sheetFocusIdx]);

  const backdrop = enrichedMovie.backdropPath || enrichedMovie.posterPath;
  const year = enrichedMovie.releaseDate?.split('-')[0];
  const runtime = formatRuntime(enrichedMovie.runtime);

  return (
    <>
    <div className="fixed inset-0 z-50 animate-in fade-in duration-300" onClick={onClose}>

      {/* Full-screen trailer */}
      {isPlayingTrailer && embedUrl && (
        <div className="fixed inset-0 z-[200] bg-black flex items-stretch">
          <iframe
            src={embedUrl}
            title={`${enrichedMovie.title} Trailer`}
            className="w-full h-full border-none"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
          <button
            onClick={() => setIsPlayingTrailer(false)}
            className="absolute top-5 right-5 z-10 flex items-center gap-2 px-4 py-2 bg-black/80 hover:bg-black border border-white/15 text-white text-xs font-bold font-mono uppercase tracking-wider rounded-full transition-all hover:scale-105 cursor-pointer shadow-2xl"
          >
            <X size={13} /> Close Trailer
          </button>
        </div>
      )}

      {/* ── BACKDROP fills entire screen ── */}
      <div className="absolute inset-0">
        {backdrop && (
          <div
            className="absolute inset-0 bg-cover bg-center scale-105 transition-all duration-700"
            style={{ backgroundImage: `url(${backdrop})`, filter: 'brightness(0.55) saturate(1.2)' }}
          />
        )}
        {/* Gradient layers for readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/30 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-transparent to-transparent" />
      </div>

      {/* ── MODAL CONTENT ── */}
      <div
        className="relative z-10 h-full flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button top-right */}
        <div className="flex justify-end items-center gap-2 p-6">
          <button
            onClick={() => setShowEditModal(true)}
            className="p-2.5 rounded-full bg-black/50 border border-white/10 text-zinc-400 hover:text-orange-400 hover:border-orange-500/50 hover:bg-zinc-800 transition-all cursor-pointer backdrop-blur-sm"
            title="Edit movie"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={onClose}
            className={`p-2.5 rounded-full bg-black/50 border text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all cursor-pointer backdrop-blur-sm ${modalFocusIdx === closeIdx ? 'border-orange-500 ring-2 ring-orange-500 text-white' : 'border-white/10'}`}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── MAIN CONTENT — top-left ── */}
        <div className="flex-1 flex items-start px-8 sm:px-14 pt-4 sm:pt-6">
          <div className="w-full max-w-5xl flex gap-10 items-start">

            {/* Poster */}
            <div className="hidden sm:block flex-shrink-0 w-44 md:w-52 lg:w-60 aspect-[2/3] rounded-2xl overflow-hidden border border-white/10 shadow-[0_32px_64px_rgba(0,0,0,0.8)] flex-shrink-0">
              <img
                src={enrichedMovie.posterPath}
                alt={enrichedMovie.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>

            {/* Metadata + actions */}
            <div className="flex-1 min-w-0 flex flex-col gap-5 pb-1">

              {/* Source/category badge */}
              <div className="flex items-center gap-2 flex-wrap">
                {enrichedMovie.isLocal && (
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-full">
                    ★ Local
                  </span>
                )}
                {/* ── Tech spec badges from ffprobe ── */}
                {localTracks?.videoInfo?.resolution && (
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 bg-blue-500/15 border border-blue-500/30 text-blue-300 rounded-full">
                    {localTracks.videoInfo.resolution}
                  </span>
                )}
                {localTracks?.videoInfo?.codec && (
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 bg-zinc-700/60 border border-zinc-600/40 text-zinc-300 rounded-full">
                    {localTracks.videoInfo.codec}
                  </span>
                )}
                {localTracks?.videoInfo?.hdr && (
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-full">
                    {localTracks.videoInfo.hdr}
                  </span>
                )}
                {localTracks?.audioLabel && (
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 bg-purple-500/15 border border-purple-500/30 text-purple-300 rounded-full">
                    {localTracks.audioLabel}
                  </span>
                )}
                {(localTracks?.subtitles?.length ?? 0) > 0 && (
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 bg-sky-500/15 border border-sky-500/30 text-sky-300 rounded-full flex items-center gap-1">
                    <Subtitles size={9} /> SUBS · {localTracks!.subtitles.length}
                  </span>
                )}
                {enrichedMovie.isTrackerItem && (
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 bg-violet-500/15 border border-violet-500/30 text-violet-400 rounded-full">
                    ⚡ TrackerFlix
                  </span>
                )}
                {episodeBadge && (
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 bg-orange-500/15 border border-orange-500/30 text-orange-400 rounded-full flex items-center gap-1">
                    <Tv size={9} /> {episodeBadge}
                  </span>
                )}
                {enrichedMovie.tagline && (
                  <span className="text-[10px] font-mono tracking-widest text-orange-400/80 uppercase">
                    {enrichedMovie.tagline}
                  </span>
                )}
                {isFetchingDetails && (
                  <span className="flex items-center gap-1 text-[10px] text-zinc-500 font-mono">
                    <Loader size={9} className="animate-spin" /> Fetching...
                  </span>
                )}
              </div>

              {/* Title */}
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-none font-sans drop-shadow-lg">
                {enrichedMovie.title}
              </h1>

              {/* Metadata strip */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-300">
                {enrichedMovie.rating > 0 && (
                  <span className="flex items-center gap-1.5 font-bold text-orange-400">
                    <Star size={14} className="fill-orange-400 text-orange-400" />
                    {enrichedMovie.rating}
                    <span className="text-zinc-500 font-normal text-xs">TMDB</span>
                  </span>
                )}
                {year && <span className="text-zinc-300">{year}</span>}
                {runtime && (
                  <span className="flex items-center gap-1.5 text-zinc-300">
                    <Timer size={13} className="text-zinc-500" />
                    {runtime}
                  </span>
                )}
                {enrichedMovie.genres?.length > 0 && (
                  <span className="text-zinc-400 text-xs">
                    {enrichedMovie.genres.slice(0, 3).join(' · ')}
                  </span>
                )}
              </div>

              {/* Overview */}
              <p className="text-sm sm:text-base text-zinc-300 leading-relaxed max-w-2xl line-clamp-3 drop-shadow">
                {enrichedMovie.overview || 'No description available.'}
              </p>

              {/* Director / Cast row */}
              {(enrichedMovie.director || (enrichedMovie.actors?.length ?? 0) > 0) && (
                <div className="flex flex-col gap-2 text-sm max-w-2xl">
                  {enrichedMovie.director && (
                    <div className="flex items-start gap-3">
                      <span className="text-zinc-500 uppercase text-[10px] font-bold tracking-widest w-20 flex-shrink-0 pt-0.5">Director</span>
                      <span className="text-zinc-200 font-medium">{enrichedMovie.director}</span>
                    </div>
                  )}
                  {(enrichedMovie.actors?.length ?? 0) > 0 && (
                    <div className="flex items-start gap-3">
                      <span className="text-zinc-500 uppercase text-[10px] font-bold tracking-widest w-20 flex-shrink-0 pt-0.5">Cast</span>
                      <span className="text-zinc-300 line-clamp-1">{enrichedMovie.actors!.slice(0, 5).join(', ')}</span>
                    </div>
                  )}
                  {enrichedMovie.isLocal && enrichedMovie.fileSize && (
                    <div className="flex items-start gap-3">
                      <span className="text-zinc-500 uppercase text-[10px] font-bold tracking-widest w-20 flex-shrink-0 pt-0.5">File</span>
                      <span className="text-zinc-300 font-mono text-xs">
                        {enrichedMovie.fileType && <span className="text-orange-400 mr-2">{enrichedMovie.fileType}</span>}
                        {enrichedMovie.fileSize}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* ── ACTION BUTTONS ── */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                {/* Play from beginning */}
                <button
                  onClick={() => onPlayClick(movie, 0, selectedAudio, null)}
                  className={`flex items-center gap-3 px-8 py-3.5 bg-orange-500 hover:bg-orange-400 text-black font-black text-sm uppercase tracking-widest rounded-xl transition-all cursor-pointer active:scale-95 shadow-lg shadow-orange-500/20 ${
                    modalFocusIdx === 0 ? 'ring-4 ring-white ring-offset-2 ring-offset-black/50 scale-105' : 'hover:scale-[1.02]'
                  }`}
                >
                  <Play size={18} fill="currentColor" />
                  <span>{isMultiEpisode ? 'Play All' : 'Play'}</span>
                </button>

                {/* Resume — only shown when a session exists beyond 30s */}
                {hasResume && (
                  <button
                    onClick={() => onPlayClick(movie, playbackSession!.currentTime, selectedAudio, null)}
                    className={`flex items-center gap-2.5 px-6 py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest transition-all cursor-pointer active:scale-95 border backdrop-blur-sm bg-white/10 border-white/15 text-white hover:bg-white/15 ${
                      modalFocusIdx === 1 ? 'ring-4 ring-orange-500 ring-offset-2 ring-offset-black/50 scale-105' : ''
                    }`}
                  >
                    <SkipForward size={14} />
                    <span>Resume</span>
                  </button>
                )}

                {/* Trailer */}
                <button
                  onClick={handleTrailerClick}
                  disabled={isFetchingDetails}
                  className={`flex items-center gap-2.5 px-6 py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest transition-all cursor-pointer active:scale-95 border backdrop-blur-sm ${
                    isPlayingTrailer
                      ? 'bg-red-500/20 border-red-500/50 text-red-400'
                      : isFetchingDetails
                      ? 'bg-white/5 border-white/10 text-zinc-600 cursor-not-allowed'
                      : 'bg-white/10 border-white/15 text-white hover:bg-white/15'
                  } ${modalFocusIdx === trailerIdx ? 'ring-4 ring-orange-500 ring-offset-2 ring-offset-black/50 scale-105' : ''}`}
                >
                  {isFetchingDetails
                    ? <><Loader size={14} className="animate-spin" /><span>Loading...</span></>
                    : <><Film size={14} /><span>{isPlayingTrailer ? 'Close Trailer' : 'Trailer'}</span></>
                  }
                </button>

                {/* Audio track button — only when >1 audio track available */}
                {(localTracks?.audioTracks?.length ?? 0) > 1 && (
                  <button
                    onClick={() => { setShowAudioPicker(p => !p); setPickerFocusIdx(-1); }}
                    className={`flex items-center gap-2 px-4 py-3.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all cursor-pointer active:scale-95 border backdrop-blur-sm bg-white/10 border-white/15 text-white hover:bg-white/15 ${audioIdx !== -1 && modalFocusIdx === audioIdx ? 'ring-4 ring-orange-500 ring-offset-2 ring-offset-black/50 scale-105' : ''}`}
                  >
                    <Volume2 size={13} />
                    <span>Audio{selectedAudio ? ` (${selectedAudio})` : ''}</span>
                  </button>
                )}

                {/* Episodes button — only for multi-episode shows */}
                {isMultiEpisode && (
                  <button
                    onClick={() => { setShowEpisodeSheet(true); setSheetFocusIdx(0); }}
                    className={`flex items-center gap-2 px-4 py-3.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all cursor-pointer active:scale-95 border backdrop-blur-sm bg-white/10 border-white/15 text-white hover:bg-white/15 ${episodesBtnIdx !== -1 && modalFocusIdx === episodesBtnIdx ? 'ring-4 ring-orange-500 ring-offset-2 ring-offset-black/50 scale-105' : ''}`}
                  >
                    <Tv size={13} />
                    <span>Episodes ({episodes.length})</span>
                  </button>
                )}

              </div>

              {/* ── INLINE TRACK PICKERS ── */}
              {showAudioPicker && localTracks?.audioTracks && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {localTracks.audioTracks.map((t, i) => (
                    <button
                      key={t.id}
                      onClick={() => { setSelectedAudio(t.id); setShowAudioPicker(false); setPickerFocusIdx(-1); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                        selectedAudio === t.id
                          ? 'bg-orange-500 border-orange-500 text-black'
                          : 'bg-white/10 border-white/15 text-zinc-300 hover:bg-white/20'
                      } ${pickerFocusIdx === i ? 'ring-2 ring-orange-400 ring-offset-1 ring-offset-black/50 scale-105' : ''}`}
                    >
                      {t.language} — {t.title} ({t.codec}, {t.channels}ch)
                    </button>
                  ))}
                </div>
              )}



            </div>
          </div>
        </div>
      </div>
    </div>

    {/* ── Episode Bottom Sheet ── */}
    {showEpisodeSheet && (
      <div
        className="fixed inset-0 z-[60] flex flex-col justify-end items-center"
        onClick={() => setShowEpisodeSheet(false)}
      >
        {/* Scrim */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

        {/* Sheet */}
        <div
          className="relative z-10 w-full max-w-2xl max-h-[72vh] flex flex-col rounded-t-2xl border border-white/10 bg-zinc-950/95 shadow-2xl animate-in slide-in-from-bottom duration-300"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Tv size={14} className="text-orange-500" />
              <span className="text-xs font-mono font-bold uppercase tracking-widest text-orange-500">
                Episodes
              </span>
              <span className="text-xs font-mono text-zinc-500 ml-1">· {episodes.length}</span>
            </div>
            <button
              onClick={() => setShowEpisodeSheet(false)}
              className="p-1.5 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-white transition-all cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          {/* Scrollable episode list */}
          <div className="overflow-y-auto flex-1 px-4 py-3 space-y-1.5 scrollbar-none">
            {episodes.map((ep, epIdx) => {
              const isFocused = sheetFocusIdx === epIdx;
              return (
                <button
                  key={ep.id}
                  ref={el => { episodeRefs.current[epIdx] = el; }}
                  onClick={() => {
                    if (onPlayEpisode) onPlayEpisode(ep, enrichedMovie);
                    setShowEpisodeSheet(false);
                  }}
                  onMouseEnter={() => setSheetFocusIdx(epIdx)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all duration-150 text-left group focus:outline-none ${
                    isFocused
                      ? 'bg-orange-500/20 border-orange-500/40 ring-2 ring-orange-500/50'
                      : 'border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/15'
                  }`}
                >
                  <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-[9px] font-black font-mono border ${
                    isFocused ? 'bg-orange-500 text-black border-transparent' : 'bg-black/40 text-orange-400 border-orange-500/30'
                  }`}>
                    {ep.season > 0 ? `${ep.season}×${String(ep.episode).padStart(2, '0')}` : String(ep.episode).padStart(2, '0')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold leading-tight truncate ${isFocused ? 'text-white' : 'text-zinc-200'}`}>{ep.title}</p>
                    <p className="text-[10px] font-mono text-zinc-500 truncate mt-0.5">{ep.filePath.split(/[/\\]/).pop()}</p>
                  </div>
                  {ep.runtime && (
                    <div className="flex-shrink-0 flex items-center gap-1 text-[10px] font-mono text-zinc-500">
                      <Clock size={10} /><span>{ep.runtime}m</span>
                    </div>
                  )}
                  <Play size={13} className={`flex-shrink-0 text-orange-500 transition-opacity ${isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`} fill="currentColor" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    )}

    {/* ── Edit Movie Modal ── */}
    {showEditModal && (
      <EditMovieModal
        movie={enrichedMovie}
        onSave={(updated) => {
          const next = { ...enrichedMovie, ...updated };
          setEnrichedMovie(next);
          onMovieUpdate?.(next);
        }}
        onClose={() => setShowEditModal(false)}
      />
    )}
    </>
  );
}
