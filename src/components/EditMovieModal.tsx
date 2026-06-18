import React, { useRef, useState } from 'react';
import { X, Pencil, ImagePlus, RotateCcw, Check, Upload, Link } from 'lucide-react';
import { Movie } from '../types';

// ── Persistence helpers ────────────────────────────────────────────────────
const STORAGE_KEY = 'plexus_movie_overrides';

export interface MovieOverride {
  title?: string;
  posterPath?: string;
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
  const ov = all[movie.id];
  if (!ov) return movie;
  return {
    ...movie,
    ...(ov.title     ? { title:      ov.title }     : {}),
    ...(ov.posterPath ? { posterPath: ov.posterPath } : {}),
  };
}
// ──────────────────────────────────────────────────────────────────────────

interface EditMovieModalProps {
  movie: Movie;
  onSave: (updated: Partial<Movie>) => void;
  onClose: () => void;
}

type PosterTab = 'url' | 'upload';

export default function EditMovieModal({ movie, onSave, onClose }: EditMovieModalProps) {
  const existing = loadOverrides()[movie.id] ?? {};

  const [title, setTitle]             = useState(existing.title     ?? movie.title);
  const [posterUrl, setPosterUrl]     = useState(existing.posterPath ?? movie.posterPath);
  const [posterTab, setPosterTab]     = useState<PosterTab>('url');
  const [urlDraft, setUrlDraft]       = useState(existing.posterPath ?? '');
  const [previewError, setPreviewError] = useState(false);
  const [saved, setSaved]             = useState(false);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

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

    saveOverride(movie.id, override);
    onSave({
      title:      override.title      ?? movie.title,
      posterPath: override.posterPath ?? movie.posterPath,
    });
    setSaved(true);
    setTimeout(onClose, 600);
  };

  // ── Reset to originals ────────────────────────────────────────────────
  const handleReset = () => {
    clearOverride(movie.id);
    setTitle(movie.title);
    setPosterUrl(movie.posterPath);
    setUrlDraft('');
    setPreviewError(false);
    onSave({ title: movie.title, posterPath: movie.posterPath });
  };

  const isDirty =
    title.trim() !== (existing.title ?? movie.title) ||
    posterUrl    !== (existing.posterPath ?? movie.posterPath);

  const hasOverride = !!(existing.title || existing.posterPath);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
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
            {/* Reset button */}
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
          <div className="flex-1 min-w-0 flex flex-col gap-5">

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
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Poster Image
              </label>

              {/* Tab switcher */}
              <div className="flex gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl w-fit">
                {(['url', 'upload'] as PosterTab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setPosterTab(tab)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      posterTab === tab
                        ? 'bg-orange-500 text-black'
                        : 'text-zinc-500 hover:text-zinc-200'
                    }`}
                  >
                    {tab === 'url' ? <Link size={10} /> : <Upload size={10} />}
                    {tab === 'url' ? 'URL' : 'Upload'}
                  </button>
                ))}
              </div>

              {posterTab === 'url' ? (
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
              ) : (
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
