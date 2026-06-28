import React, { useRef, useState, useEffect, useCallback } from 'react';
import { X, Pencil, ImagePlus, RotateCcw, Check, Upload, Link, Search, Loader2, ChevronLeft, ChevronRight as ChevronRightIcon } from 'lucide-react';
import { Movie } from '../types';

// ── Persistence helpers ────────────────────────────────────────────────────
const STORAGE_KEY = 'plexus_movie_overrides';

export interface MovieOverride {
  title?: string;
  posterPath?: string;
}

/** Stable unique key for a movie — prefers localFilePath over id to avoid
 *  server-side ID collisions when multiple files share the same path prefix. */
function overrideKey(movie: { id: string; localFilePath?: string }): string {
  return movie.localFilePath || movie.id;
}

export function loadOverrides(): Record<string, MovieOverride> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveOverride(movieId: string, override: MovieOverride) {
  const all = loadOverrides();
  all[movieId] = { ...all[movieId], ...override };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function clearOverride(movieId: string) {
  const all = loadOverrides();
  delete all[movieId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** Apply any saved overrides to a Movie object before rendering */
export function applyOverrides(movie: Movie): Movie {
  const all = loadOverrides();
  const ov = all[overrideKey(movie)];
  if (!ov) return movie;
  return {
    ...movie,
    ...(ov.title      ? { title:      ov.title }      : {}),
    ...(ov.posterPath ? { posterPath: ov.posterPath } : {}),
  };
}
// ──────────────────────────────────────────────────────────────────────────

interface TmdbPosterResult {
  file_path: string;
  vote_average: number;
  vote_count: number;
  width: number;
  height: number;
  iso_639_1: string | null;
}

interface EditMovieModalProps {
  movie: Movie;
  onSave: (updated: Partial<Movie>) => void;
  onClose: () => void;
  /** Pass tmdbConfig.apiKey from App so the TMDB browse tab can fetch posters */
  tmdbApiKey?: string;
}

type PosterTab = 'tmdb' | 'url' | 'upload';

const TMDB_IMG = 'https://image.tmdb.org/t/p/';

export default function EditMovieModal({ movie, onSave, onClose, tmdbApiKey }: EditMovieModalProps) {
  const key = overrideKey(movie);
  const existing = loadOverrides()[key] ?? {};

  const [title, setTitle]               = useState(existing.title     ?? movie.title);
  const [posterUrl, setPosterUrl]       = useState(existing.posterPath ?? movie.posterPath ?? '');
  const [posterTab, setPosterTab]       = useState<PosterTab>(tmdbApiKey ? 'tmdb' : 'url');
  const [urlDraft, setUrlDraft]         = useState(existing.posterPath ?? '');
  const [previewError, setPreviewError] = useState(false);
  const [saved, setSaved]               = useState(false);
  const fileInputRef                    = useRef<HTMLInputElement>(null);

  // ── TMDB browse state ─────────────────────────────────────────────────
  const [tmdbQuery, setTmdbQuery]           = useState(existing.title ?? movie.title ?? '');
  const [tmdbPosters, setTmdbPosters]       = useState<TmdbPosterResult[]>([]);
  const [tmdbStatus, setTmdbStatus]         = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [tmdbPage, setTmdbPage]             = useState(0);   // index into paged chunks of 6
  const [selectedTmdbPath, setSelectedTmdbPath] = useState<string | null>(null);

  const POSTERS_PER_PAGE = 6;

  // Auto-search on mount when TMDB tab is active and key is available
  useEffect(() => {
    if (posterTab === 'tmdb' && tmdbApiKey && tmdbStatus === 'idle') {
      fetchTmdbPosters(tmdbQuery);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posterTab]);

  const fetchTmdbPosters = useCallback(async (query: string) => {
    if (!tmdbApiKey || !query.trim()) return;
    setTmdbStatus('loading');
    setTmdbPosters([]);
    setTmdbPage(0);
    setSelectedTmdbPath(null);
    try {
      const isV4 = tmdbApiKey.trim().startsWith('eyJ');
      const headers: Record<string, string> = isV4
        ? { Authorization: `Bearer ${tmdbApiKey.trim()}` }
        : {};

      // 1. Search for the movie/TV show to get its TMDB id
      const isTV = (movie.genres ?? []).some(g =>
        g.toLowerCase().includes('tv') || g.toLowerCase().includes('series')
      );
      const searchType = isTV ? 'tv' : 'movie';
      const searchUrl = isV4
        ? `https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(query.trim())}&language=en-US&page=1`
        : `https://api.themoviedb.org/3/search/${searchType}?api_key=${tmdbApiKey}&query=${encodeURIComponent(query.trim())}&language=en-US&page=1`;

      const searchRes = await fetch(searchUrl, { headers });
      if (!searchRes.ok) throw new Error(`Search failed: ${searchRes.status}`);
      const searchData = await searchRes.json();
      const firstResult = (searchData.results ?? [])[0];

      if (!firstResult) {
        setTmdbStatus('done');
        return;
      }

      // 2. Fetch all poster images for that title
      const imagesUrl = isV4
        ? `https://api.themoviedb.org/3/${searchType}/${firstResult.id}/images`
        : `https://api.themoviedb.org/3/${searchType}/${firstResult.id}/images?api_key=${tmdbApiKey}`;

      const imagesRes = await fetch(imagesUrl, { headers });
      if (!imagesRes.ok) throw new Error(`Images fetch failed: ${imagesRes.status}`);
      const imagesData = await imagesRes.json();

      // Sort: language-matched first, then by vote_average desc
      const allPosters: TmdbPosterResult[] = (imagesData.posters ?? []);
      allPosters.sort((a, b) => {
        const aEn = a.iso_639_1 === 'en' ? 1 : 0;
        const bEn = b.iso_639_1 === 'en' ? 1 : 0;
        if (bEn !== aEn) return bEn - aEn;
        return b.vote_average - a.vote_average;
      });

      setTmdbPosters(allPosters);
      setTmdbStatus('done');
    } catch (err) {
      console.error('[EditMovieModal] TMDB poster fetch failed:', err);
      setTmdbStatus('error');
    }
  }, [tmdbApiKey, movie.genres]);

  const applyTmdbPoster = (filePath: string) => {
    const full = `${TMDB_IMG}w500${filePath}`;
    setSelectedTmdbPath(filePath);
    setPosterUrl(full);
    setPreviewError(false);
  };

  const totalTmdbPages = Math.ceil(tmdbPosters.length / POSTERS_PER_PAGE);
  const visiblePosters = tmdbPosters.slice(
    tmdbPage * POSTERS_PER_PAGE,
    (tmdbPage + 1) * POSTERS_PER_PAGE
  );

  // ── Poster upload → data URL ──────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setPosterUrl(result);
      setPreviewError(false);
    };
    reader.readAsDataURL(file);
  };

  const applyUrl = () => {
    const trimmed = urlDraft.trim();
    if (trimmed) {
      setPosterUrl(trimmed);
      setPreviewError(false);
    }
  };

  // ── Save ─────────────────────────────────────────────────────────────
  const handleSave = () => {
    const override: MovieOverride = {};
    if (title.trim() && title.trim() !== movie.title) override.title = title.trim();
    if (posterUrl && posterUrl !== movie.posterPath)   override.posterPath = posterUrl;

    saveOverride(key, override);
    onSave({
      title:      override.title      ?? movie.title,
      posterPath: override.posterPath ?? movie.posterPath,
    });
    setSaved(true);
    setTimeout(onClose, 600);
  };

  // ── Reset to originals ────────────────────────────────────────────────
  const handleReset = () => {
    clearOverride(key);
    setTitle(movie.title);
    setPosterUrl(movie.posterPath ?? '');
    setUrlDraft('');
    setPreviewError(false);
    setSelectedTmdbPath(null);
    onSave({ title: movie.title, posterPath: movie.posterPath });
  };

  const isDirty =
    title.trim() !== (existing.title ?? movie.title) ||
    posterUrl    !== (existing.posterPath ?? movie.posterPath ?? '');

  const hasOverride = !!(existing.title || existing.posterPath);

  const tabs: { id: PosterTab; label: string; icon: React.ReactNode }[] = [
    ...(tmdbApiKey ? [{ id: 'tmdb' as PosterTab, label: 'TMDB', icon: <Search size={10} /> }] : []),
    { id: 'url',    label: 'URL',    icon: <Link size={10} /> },
    { id: 'upload', label: 'Upload', icon: <Upload size={10} /> },
  ];

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="bg-orange-500/10 border border-orange-500/30 p-2 rounded-xl text-orange-500">
              <Pencil size={14} />
            </div>
            <div>
              <h2 className="text-sm font-black text-white">Edit Movie</h2>
              <p className="text-[10px] text-zinc-500 font-mono">Overrides are saved locally</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="flex gap-5 p-6">

          {/* Poster preview */}
          <div className="flex-shrink-0 flex flex-col gap-2">
            <div className="w-28 aspect-[2/3] rounded-xl overflow-hidden border border-zinc-700 bg-zinc-900 shadow-lg">
              {posterUrl && !previewError ? (
                <img
                  src={posterUrl}
                  alt="Poster preview"
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={() => setPreviewError(true)}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-zinc-600">
                  <ImagePlus size={22} />
                  <span className="text-[9px] font-mono text-center px-2">No preview</span>
                </div>
              )}
            </div>
            {hasOverride && (
              <button
                onClick={handleReset}
                className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-500/40 text-[10px] font-mono font-bold uppercase tracking-wider transition-all cursor-pointer"
              >
                <RotateCcw size={10} /> Reset
              </button>
            )}
          </div>

          {/* Fields */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">

            {/* Title field */}
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm font-bold text-white placeholder-zinc-600 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all caret-orange-500"
                placeholder="Movie title…"
              />
            </div>

            {/* Poster field */}
            <div className="flex flex-col gap-2">
              <label className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Poster Image
              </label>

              {/* Tab switcher */}
              <div className="flex gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl w-fit">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setPosterTab(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      posterTab === tab.id
                        ? 'bg-orange-500 text-black'
                        : 'text-zinc-500 hover:text-zinc-200'
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* ── TMDB Browse ─────────────────────────────────────── */}
              {posterTab === 'tmdb' && (
                <div className="flex flex-col gap-2">
                  {/* Search bar */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={tmdbQuery}
                      onChange={e => setTmdbQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && fetchTmdbPosters(tmdbQuery)}
                      className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-zinc-600 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all caret-orange-500"
                      placeholder="Search TMDB…"
                      spellCheck={false}
                    />
                    <button
                      onClick={() => fetchTmdbPosters(tmdbQuery)}
                      disabled={tmdbStatus === 'loading'}
                      className="px-3 py-2 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-black rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider"
                    >
                      {tmdbStatus === 'loading'
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Search size={12} />}
                      Search
                    </button>
                  </div>

                  {/* Poster grid */}
                  {tmdbStatus === 'loading' && (
                    <div className="flex items-center justify-center py-6 text-zinc-500 gap-2 text-xs font-mono">
                      <Loader2 size={14} className="animate-spin" /> Fetching posters…
                    </div>
                  )}

                  {tmdbStatus === 'error' && (
                    <div className="text-center py-4 text-red-400 text-xs font-mono">
                      Failed to fetch — check TMDB key in Settings.
                    </div>
                  )}

                  {tmdbStatus === 'done' && tmdbPosters.length === 0 && (
                    <div className="text-center py-4 text-zinc-500 text-xs font-mono">
                      No posters found. Try a different title.
                    </div>
                  )}

                  {tmdbStatus === 'done' && tmdbPosters.length > 0 && (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        {visiblePosters.map(p => {
                          const isSelected = selectedTmdbPath === p.file_path;
                          return (
                            <button
                              key={p.file_path}
                              onClick={() => applyTmdbPoster(p.file_path)}
                              className={`relative aspect-[2/3] rounded-lg overflow-hidden border-2 transition-all cursor-pointer group ${
                                isSelected
                                  ? 'border-orange-500 ring-2 ring-orange-500/40 scale-[1.03]'
                                  : 'border-zinc-700 hover:border-orange-500/50'
                              }`}
                            >
                              <img
                                src={`${TMDB_IMG}w185${p.file_path}`}
                                alt="TMDB poster"
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                              {isSelected && (
                                <div className="absolute inset-0 bg-orange-500/20 flex items-center justify-center">
                                  <Check size={20} className="text-white drop-shadow-lg" />
                                </div>
                              )}
                              {/* Vote badge */}
                              {p.vote_count > 0 && (
                                <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[8px] font-mono px-1 py-0.5 rounded">
                                  ★ {p.vote_average.toFixed(1)}
                                </div>
                              )}
                              {/* Language badge */}
                              {p.iso_639_1 && (
                                <div className="absolute top-1 left-1 bg-black/70 text-zinc-300 text-[8px] font-mono px-1 py-0.5 rounded uppercase">
                                  {p.iso_639_1}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Pagination */}
                      {totalTmdbPages > 1 && (
                        <div className="flex items-center justify-between pt-1">
                          <button
                            onClick={() => setTmdbPage(p => Math.max(0, p - 1))}
                            disabled={tmdbPage === 0}
                            className="p-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                          >
                            <ChevronLeft size={12} />
                          </button>
                          <span className="text-[9px] font-mono text-zinc-500">
                            {tmdbPage + 1} / {totalTmdbPages} · {tmdbPosters.length} posters
                          </span>
                          <button
                            onClick={() => setTmdbPage(p => Math.min(totalTmdbPages - 1, p + 1))}
                            disabled={tmdbPage >= totalTmdbPages - 1}
                            className="p-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                          >
                            <ChevronRightIcon size={12} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── URL tab ──────────────────────────────────────────── */}
              {posterTab === 'url' && (
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={urlDraft}
                    onChange={e => setUrlDraft(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && applyUrl()}
                    className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-xs font-mono text-white placeholder-zinc-600 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all caret-orange-500"
                    placeholder="https://image.tmdb.org/…"
                    spellCheck={false}
                  />
                  <button
                    onClick={applyUrl}
                    className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white text-[10px] font-mono font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                  >
                    Apply
                  </button>
                </div>
              )}

              {/* ── Upload tab ───────────────────────────────────────── */}
              {posterTab === 'upload' && (
                <>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 py-3 px-4 bg-zinc-900 hover:bg-zinc-800 border border-dashed border-zinc-700 hover:border-orange-500/50 text-zinc-400 hover:text-orange-400 text-xs font-mono font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                  >
                    <Upload size={14} />
                    Choose image file
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty || saved}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
              saved
                ? 'bg-emerald-500 text-black border-transparent'
                : isDirty
                ? 'bg-orange-500 hover:bg-orange-400 text-black active:scale-95'
                : 'bg-zinc-800 text-zinc-600 border border-zinc-700 cursor-not-allowed'
            }`}
          >
            {saved ? <><Check size={13} /> Saved!</> : <><Pencil size={13} /> Save Changes</>}
          </button>
        </div>
      </div>
    </div>
  );
}
