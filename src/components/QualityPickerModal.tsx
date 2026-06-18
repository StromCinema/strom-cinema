import React, { useEffect, useRef, useMemo } from 'react';
import { X, Zap, Wifi } from 'lucide-react';
import { Movie, TrackerRelease } from '../types';

interface QualityPickerModalProps {
  movie: Movie;
  onSelect: (releaseId: string) => void;
  onClose: () => void;
}

interface QualityBucket {
  key: string;
  label: string;
  bestRelease: TrackerRelease;
  count: number;
}

function bucketKey(release: TrackerRelease): string {
  // Derive quality+codec bucket key from the label (e.g. "1080p · H265 · ...")
  const parts = release.label.split('·').map(s => s.trim());
  const quality = release.quality || parts[0] || 'Unknown';
  // Look for codec token in label parts
  const codecMatch = parts.find(p => /H265|H264|AV1|HEVC|AVC/i.test(p));
  return codecMatch ? `${quality} · ${codecMatch}` : quality;
}

export default function QualityPickerModal({ movie, onSelect, onClose }: QualityPickerModalProps) {
  const releases = movie.trackerReleases ?? [];

  // Group releases into quality+codec buckets, best seeder per bucket
  const buckets = useMemo<QualityBucket[]>(() => {
    const map = new Map<string, QualityBucket>();
    for (const r of releases) {
      const key = bucketKey(r);
      const existing = map.get(key);
      if (!existing || r.seeders > existing.bestRelease.seeders) {
        map.set(key, {
          key,
          label: key,
          bestRelease: r,
          count: (existing?.count ?? 0) + 1,
        });
      } else {
        existing.count += 1;
      }
    }
    // Sort by seeders descending
    return [...map.values()].sort((a, b) => b.bestRelease.seeders - a.bestRelease.seeders);
  }, [releases]);

  const [focusIdx, setFocusIdx] = React.useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    itemRefs.current[focusIdx]?.focus({ preventScroll: false });
  }, [focusIdx]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setFocusIdx(prev => Math.min(prev + 1, buckets.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setFocusIdx(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter': {
          e.preventDefault();
          e.stopPropagation();
          const bucket = buckets[focusIdx];
          if (bucket) onSelect(bucket.bestRelease.id);
          break;
        }
        case 'Escape':
        case 'Backspace':
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [focusIdx, buckets, onSelect, onClose]);

  const seederColor = (seeders: number) => {
    if (seeders >= 10) return 'text-emerald-400';
    if (seeders >= 1)  return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative z-10 bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={movie.posterPath}
              alt={movie.title}
              className="w-10 h-14 object-cover rounded-lg border border-white/10 flex-shrink-0"
              referrerPolicy="no-referrer"
            />
            <div className="min-w-0">
              <h3 className="text-white font-bold text-sm truncate">{movie.title}</h3>
              <p className="text-zinc-400 text-[10px] font-mono mt-0.5">Select quality to stream</p>
              <p className="text-zinc-600 text-[9px] font-mono mt-1 uppercase tracking-wider">▲ ▼ navigate · Enter select · Esc close</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors cursor-pointer flex-shrink-0 ml-3 p-1 rounded-lg hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </div>

        {/* Bucketed release list */}
        <div className="space-y-2">
          {buckets.map((bucket, i) => {
            const isFocused = focusIdx === i;
            const r = bucket.bestRelease;
            return (
              <button
                key={bucket.key}
                ref={el => { itemRefs.current[i] = el; }}
                onClick={() => onSelect(r.id)}
                onFocus={() => setFocusIdx(i)}
                className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border text-left transition-all cursor-pointer group focus:outline-none ${
                  isFocused
                    ? 'bg-violet-500/15 border-violet-500/60 ring-2 ring-violet-500/40'
                    : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 hover:border-violet-500/40'
                }`}
              >
                <div>
                  <span className="text-white text-xs font-bold block">{bucket.label}</span>
                  <span className="text-zinc-400 text-[10px] font-mono mt-0.5 block">
                    best of {bucket.count} · {r.size}
                  </span>
                </div>
                <div className="flex items-center gap-2.5 flex-shrink-0">
                  <div className="flex items-center gap-1">
                    <Wifi size={10} className={seederColor(r.seeders)} />
                    <span className={`text-[10px] font-mono font-bold ${seederColor(r.seeders)}`}>
                      {r.seeders} seeds
                    </span>
                  </div>
                  {bucket.count > 1 && (
                    <span className="text-[9px] font-mono bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded">
                      ×{bucket.count}
                    </span>
                  )}
                  <Zap
                    size={14}
                    className={`text-violet-400 transition-opacity ${isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
