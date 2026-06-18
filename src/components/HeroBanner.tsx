import React from 'react';
import { Play, Info, Star, Clock, User } from 'lucide-react';
import { Movie } from '../types';

interface HeroBannerProps {
  movie: Movie | null;
  onPlayClick: (movie: Movie) => void;
  onInfoClick: (movie: Movie) => void;
  isFocused?: boolean;
  targetPlatform?: 'windows' | 'android-tv' | 'tizen-tv';
}

export default function HeroBanner({ movie, onPlayClick, onInfoClick, isFocused = false, targetPlatform = 'windows' }: HeroBannerProps) {
  const isTizen = targetPlatform === 'tizen-tv';
  const accentTextClass = isTizen ? 'text-cyan-400' : 'text-orange-500';
  const accentLightTextClass = isTizen ? 'text-cyan-400' : 'text-orange-400';
  const primaryBtnClass = isTizen 
    ? 'bg-cyan-400 hover:bg-cyan-300 border-cyan-400 hover:border-cyan-300'
    : 'bg-orange-500 hover:bg-orange-400 border-orange-500 hover:border-orange-400';
  const shadowClass = isTizen ? 'shadow-cyan-455/15' : 'shadow-orange-500/10';
  const focusRingClass = isTizen 
    ? 'ring-4 ring-cyan-400 ring-offset-2 ring-offset-[#050505]'
    : 'ring-4 ring-orange-500 ring-offset-2 ring-offset-[#050505]';

  if (!movie) {
    return (
      <div
        id="cinematic-hero-banner-viewport"
        className="relative w-full min-h-0 h-0 overflow-hidden"
      >
        <div className="text-center space-y-4 z-20 max-w-xl">
          <span className={`${accentTextClass} text-[10px] sm:text-[11px] font-mono font-extrabold tracking-widest uppercase`}>
            NO ACTIVE MEDIA CATALOG
          </span>
          <h1 className="text-2xl sm:text-3xl font-sans tracking-tight font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-slate-400 leading-none uppercase">
            Ready for your streams
          </h1>
          <p className="text-[11px] sm:text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
            Your media stream server or index list is empty. Set your TMDB key or run your **Windows Companion Service** on port 5000 to instantly index and stream your home videos.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      id="cinematic-hero-banner-viewport"
      className="relative w-full h-[40vh] xl:h-[45vh] flex items-start overflow-hidden transition-all duration-700 bg-transparent"
    >
      {/* Foreground Content Panel */}
      <div 
        id="hero-content-anchor" 
        className={`relative z-20 w-full max-w-7xl mx-auto px-6 sm:px-8 xl:px-12 pt-8 sm:pt-10 flex flex-col items-start gap-4 transition-all duration-500 transform ${
          isFocused ? 'scale-[1.01] translate-x-1' : ''
        }`}
      >
        {/* Immersive Tagline Match Badges */}
        <div className="flex items-center gap-3">
          <span 
            id="hero-tagline-badge"
            className={`${accentTextClass} text-[11px] font-mono font-extrabold tracking-widest uppercase`}
          >
            ★ {movie.tagline ? movie.tagline.toUpperCase() : 'CINEMATIC PREMIERE'}
          </span>
          <span className={`${accentLightTextClass} font-bold text-xs tracking-tighter uppercase font-mono`}>98% MATCH</span>
        </div>

        {/* Title Text */}
        <h1 
          id="hero-movie-title"
          className="text-4xl sm:text-5xl lg:text-7xl font-sans tracking-tighter font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-slate-400 max-w-3xl drop-shadow-md leading-none uppercase"
        >
          {movie.title}
        </h1>

        {/* Cinematic Metadata line */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-300 font-medium">
          {/* Rating Badge */}
          <div className="flex items-center gap-1.5 font-bold">
            <Star size={14} className={`fill-current ${accentTextClass} ${accentTextClass}`} />
            <span className={accentLightTextClass}>{movie.rating}</span>
          </div>

          <span className="text-white/10">|</span>

          {/* Release Date Year */}
          <span>{movie.releaseDate.split('-')[0]}</span>

          <span className="text-white/10">|</span>

          {/* Runtime */}
          <div className="flex items-center gap-1 text-zinc-300">
            <Clock size={13} className="text-zinc-400" />
            <span>{movie.runtime}m</span>
          </div>

          {movie.director && (
            <>
              <span className="text-white/10">|</span>
              <div className="flex items-center gap-1 text-zinc-300">
                <User size={13} className="text-zinc-400" />
                <span>Dir: <strong className="text-zinc-100">{movie.director}</strong></span>
              </div>
            </>
          )}

          <span className="text-white/10">|</span>

          {/* Genres */}
          <span className={`${accentLightTextClass} font-mono text-[11px] tracking-wide`}>{movie.genres.join(' • ')}</span>
        </div>

        {/* Description Overview block */}
        <p 
          id="hero-movie-overview"
          className="text-sm sm:text-base text-zinc-400 max-w-2xl leading-relaxed font-sans line-clamp-3 md:line-clamp-4 drop-shadow"
        >
          {movie.overview}
        </p>

        {/* Navigation Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 mt-2" onClick={(e) => e.stopPropagation()}>
          <button
            id="hero-play-button"
            onClick={() => onPlayClick(movie)}
            className={`flex items-center gap-2.5 px-6 py-3 rounded-xl font-bold text-xs sm:text-sm uppercase tracking-wider transition-all duration-300 hover:scale-[1.02] text-black cursor-pointer shadow-lg active:scale-95 border-2 ${primaryBtnClass} ${shadowClass} ${
              isFocused ? focusRingClass : ''
            }`}
          >
            <Play size={16} fill="currentColor" />
            <span>Play Video</span>
          </button>

          <button
            id="hero-info-button"
            onClick={() => onInfoClick(movie)}
            className="flex items-center gap-2.5 px-6 py-3 rounded-xl font-bold text-xs sm:text-sm uppercase tracking-wider transition-all duration-300 bg-white/5 hover:bg-white/10 text-white hover:text-white border border-white/10 active:scale-95 cursor-pointer backdrop-blur-md"
          >
            <Info size={16} />
            <span>Movie Info</span>
          </button>
        </div>
      </div>
    </div>
  );
}
