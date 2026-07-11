import React, { useRef, useState, useEffect } from 'react';
import Hls from 'hls.js';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Minimize2, Maximize2, SkipForward, SkipBack, Settings, Sliders, Type, FastForward } from 'lucide-react';
import { Movie, PlayerSettings, PlaybackSession } from '../types';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';

// Native StromPlayer plugin — handles ExoPlayer via PlayerActivity.java
const StromPlayer = registerPlugin<{
  play: (opts: {
    url: string;
    title: string;
    audioTrack: number;
    subtitleTrack: number;
  }) => Promise<void>;
  addListener: (event: string, handler: () => void) => Promise<{ remove: () => void }>;
}>('StromPlayer');

interface CinemaVideoPlayerProps {
  movie: Movie;
  settings: PlayerSettings;
  onClose: () => void;
  onUpdateSession: (newSession: PlaybackSession) => void;
  // Option to pass a real File if uploaded
  localVideoFile?: File | null;
  // Track selections forwarded to ExoPlayer on Android
  audioTrack?: number;
  subtitleTrack?: number;
}

export default function CinemaVideoPlayer({
  movie,
  settings,
  onClose,
  onUpdateSession,
  localVideoFile,
  audioTrack = -1,
  subtitleTrack = -1,
}: CinemaVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  
  // Player tweaks
  const [aspect, setAspect] = useState<PlayerSettings['aspectRatio']>(settings.aspectRatio);
  const [speed, setSpeed] = useState<number>(settings.playbackSpeed);
  const [activeTab, setActiveTab] = useState<'audio' | 'subtitles' | null>(null);
  const [audioDelay, setAudioDelay] = useState<number>(settings.audioDelay);

  // For MKV/AVI/MOV warning banner
  const [codecAlert, setCodecAlert] = useState<string | null>(null);

  // Auto-hide controls timer
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Subtitle emulation lines based on duration times
  const [subText, setSubText] = useState<string>("");

  // Determine Source Video
  // Default fallback stream if no file is selected. A beautiful high-quality nature reel
  const sampleStreams = [
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4'
  ];
  
  // Pick one based on movie id
  const mainStreamIndex = Math.abs(hashCode(movie.id)) % sampleStreams.length;
  const initialVideoSrc = sampleStreams[mainStreamIndex];
  const [videoSrc, setVideoSrc] = useState<string>("");

  function hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hash;
  }

  // Pre-load file or fallback
  useEffect(() => {
    if (localVideoFile) {
      // Priority 1: drag & drop file from browser
      const objectUrl = URL.createObjectURL(localVideoFile);
      setVideoSrc(objectUrl);
      setCodecAlert(null);
      return () => {
        URL.revokeObjectURL(objectUrl);
      };
    } else if ((movie as any).streamUrl) {
      // Priority 2a: pre-built stream URL from playNative() on Android
      setVideoSrc((movie as any).streamUrl);
      setCodecAlert(null);
    } else if (movie.isLocal && (movie.localFilePath || movie.sourcePath)) {
      // Priority 2: local file via companion server.
      // Prefer the absolute trailerUrl the server stamped on the movie object
      // (e.g. http://localhost:5000/api/stream?path=...) so it works in both
      // dev mode and when served from dist/. Fall back to building the URL from
      // the stored companion host via localStorage, then a last-resort relative path.
      if (movie.trailerUrl && (movie.trailerUrl.startsWith('http://') || movie.trailerUrl.startsWith('https://'))) {
        setVideoSrc(movie.trailerUrl);
      } else {
        const filePath = movie.localFilePath || movie.sourcePath || '';
        const savedHost = localStorage.getItem('plexus_companion_host') || 'http://localhost:5000';
        const streamUrl = `${savedHost}/api/stream?path=${encodeURIComponent(filePath)}`;
        setVideoSrc(streamUrl);
      }
      setCodecAlert(null);
    } else if (movie.trailerUrl?.startsWith('http://localhost') || movie.trailerUrl?.startsWith('http://192.168.') || movie.trailerUrl?.startsWith('http://10.')) {
      // Priority 3: TrackerFlix remux / other LAN stream
      setVideoSrc(movie.trailerUrl);
      setCodecAlert(null);
    } else {
      // Priority 4: sample fallback (short clip — will stop at ~20s, this is the bug to avoid)
      setVideoSrc(initialVideoSrc);
      setCodecAlert(`No local file linked — playing sample stream`);
    }
  }, [movie, localVideoFile]);

  // Attach the source to the video element. HLS playlists (.m3u8) need hls.js
  // on Chrome/Edge/Firefox; Safari has native HLS support. Plain MP4/WebM/MKV
  // get the src attribute set directly so the browser handles range requests.
  useEffect(() => {
    if (!videoSrc) return;

    // On Android TV — launch ExoPlayer via our native StromPlayerPlugin.
    // PlayerActivity runs inside the same Capacitor Activity so the back
    // button returns here instead of backgrounding the whole app.
    if (Capacitor.isNativePlatform()) {
      let listener: { remove: () => void } | null = null;

      StromPlayer.addListener('playerClosed', () => {
        if (listener) listener.remove();
        onClose();
      }).then(l => { listener = l; });

      StromPlayer.play({
        url: videoSrc,
        title: movie.title,
        audioTrack,
        subtitleTrack,
      })
        .catch((err: any) => {
          console.error('[StromPlayer] Failed to launch:', err);
          if (listener) listener.remove();
          onClose();
        });

      return () => { if (listener) listener.remove(); };
    }

    // Web/Desktop — existing HLS + HTML5 logic unchanged below
    const video = videoRef.current;
    if (!video) return;

    const isHls = /\.m3u8(\?|$)/i.test(videoSrc);
    console.log('%c[Player] === NEW BUILD === videoSrc=', 'color:#0ff;font-weight:bold', videoSrc, 'isHls=', isHls);
    let hls: Hls | null = null;

    if (isHls) {
      if (Hls.isSupported()) {
        // Custom loader: intercept the manifest response and rewrite it as VOD.
        // TrackerFlix's FFmpeg pipeline produces a "live" playlist (no
        // #EXT-X-ENDLIST), so hls.js by default chases the live edge and
        // jumps forward whenever new segments are appended — which manifests
        // as the video skipping ahead by minutes.
        //
        // Stripping any live tags and forcing PLAYLIST-TYPE:VOD makes hls.js
        // treat each fetch as a complete VOD manifest, so it plays from the
        // beginning sequentially without ever jumping.
        class VODManifestLoader extends (Hls.DefaultConfig.loader as any) {
          load(context: any, config: any, callbacks: any) {
            const isManifest =
              context.type === 'manifest' ||
              context.type === 'level' ||
              (typeof context.url === 'string' && /\.m3u8(\?|$)/i.test(context.url));

            if (isManifest) {
              const originalOnSuccess = callbacks.onSuccess;
              callbacks.onSuccess = (response: any, stats: any, ctx: any, networkDetails: any) => {
                if (typeof response.data === 'string') {
                  let txt: string = response.data;
                  // Strip live-only directives and force VOD
                  txt = txt.replace(/#EXT-X-PLAYLIST-TYPE:[^\n]*\n/gi, '');
                  // Inject PLAYLIST-TYPE:VOD after #EXTM3U
                  txt = txt.replace(/#EXTM3U\s*\n/, '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n');
                  // If FFmpeg hasn't ended yet, the manifest won't have ENDLIST.
                  // We deliberately DO NOT add ENDLIST here — that would tell
                  // hls.js the stream is done and prevent it from re-fetching
                  // the manifest for new segments. PLAYLIST-TYPE:VOD alone
                  // tells hls.js segments will never change, which is enough
                  // to stop the live-edge chasing.
                  response.data = txt;
                }
                originalOnSuccess(response, stats, ctx, networkDetails);
              };
            }
            super.load(context, config, callbacks);
          }
        }

        hls = new Hls({
          startPosition: 0,
          maxBufferLength: 30,
          maxMaxBufferLength: 600,
          maxBufferSize: 600 * 1024 * 1024,
          backBufferLength: 90,
          liveSyncDurationCount: 0,
          lowLatencyMode: false,
          loader: VODManifestLoader as any,
        });
        hls.loadSource(videoSrc);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
          console.log('[Hls.js] manifest parsed, fragments:', data.levels[0]?.details?.fragments?.length, 'live:', data.levels[0]?.details?.live);
          video.currentTime = 0;
        });

        hls.on(Hls.Events.LEVEL_LOADED, (_evt, data) => {
          console.log('[Hls.js] level loaded, fragments:', data.details.fragments.length, 'live:', data.details.live, 'totalDur:', data.details.totalduration?.toFixed(1));
        });

        hls.on(Hls.Events.FRAG_LOADED, (_evt, data) => {
          console.log('[Hls.js] fragment loaded:', data.frag.sn);
        });

        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (data.fatal) {
            console.error('[Hls.js] Fatal error:', data.type, data.details);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls?.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls?.recoverMediaError();
                break;
              default:
                hls?.destroy();
                break;
            }
          } else {
            console.warn('[Hls.js] Non-fatal:', data.type, data.details);
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS
        video.src = videoSrc;
      } else {
        console.error('[Player] HLS not supported in this browser');
      }
    } else {
      // Plain video file — browser handles range requests
      video.src = videoSrc;
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [videoSrc]);

  // Read saved session progress if exists
  useEffect(() => {
    const sessionsRaw = localStorage.getItem('plexus_playback_sessions');
    if (sessionsRaw && videoRef.current) {
      const list: PlaybackSession[] = JSON.parse(sessionsRaw);
      const matched = list.find(s => s.movieId === movie.id);
      if (matched && matched.currentTime > 2) {
        // Seek to last played time
        videoRef.current.currentTime = matched.currentTime;
        setCurrentTime(matched.currentTime);
      }
    }
  }, [movie.id, videoSrc]);

  // Trigger auto-hide controls on mouse tracking
  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
        setActiveTab(null);
      }
    }, 4000);
  };

  useEffect(() => {
    resetControlsTimeout();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying]);



  // Bound playback speed
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  }, [speed]);

  // Volume binding
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  // Persist video position
  useEffect(() => {
    const handleProgress = () => {
      if (!videoRef.current) return;
      const curr = videoRef.current.currentTime;
      const dur = videoRef.current.duration || 1;
      
      setCurrentTime(curr);
      if (isFinite(videoRef.current.duration) && videoRef.current.duration > 0) {
        setDuration(videoRef.current.duration);
      }

      if (curr > 1) {
        onUpdateSession({
          movieId: movie.id,
          title: movie.title,
          posterPath: movie.posterPath,
          backdropPath: movie.backdropPath,
          currentTime: Math.floor(curr),
          duration: Math.floor(dur),
          lastPlayedAt: new Date().toISOString()
        });
      }
    };

    const vid = videoRef.current;
    if (vid) {
      const onDuration = () => {
        if (isFinite(vid.duration) && vid.duration > 0) {
          setDuration(vid.duration);
        }
      };
      vid.addEventListener('timeupdate', handleProgress);
      vid.addEventListener('loadedmetadata', onDuration);
      vid.addEventListener('durationchange', onDuration);
      // If metadata already loaded before this effect ran, grab it immediately
      if (isFinite(vid.duration) && vid.duration > 0) {
        setDuration(vid.duration);
      }
    }

    return () => {
      if (vid) {
        vid.removeEventListener('timeupdate', handleProgress);
        vid.removeEventListener('loadedmetadata', () => {});
        vid.removeEventListener('durationchange', () => {});
      }
    };
  }, [movie, onUpdateSession]);

  // Capacitor hardware back button — safety net for Android TV remote.
  // The primary handler is onActivityResult in StromPlayerPlugin.java but
  // this catches any edge cases where the JS layer is still mounted.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handler = CapacitorApp.addListener('backButton', () => {
      onClose();
    });
    return () => { handler.then(h => h.remove()); };
  }, [onClose]);

  // Keybindings matching TV Remote / Arrow buttons inside the player focus
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'MediaPlayPause') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft' || e.key === 'MediaRewind') {
        e.preventDefault();
        seek(-10);
      } else if (e.key === 'ArrowRight' || e.key === 'MediaFastForward') {
        e.preventDefault();
        seek(10);
      } else if (
        e.key === 'Escape' ||
        e.key === 'GoBack' ||
        e.key === 'BrowserBack' ||
        e.key === 'Back'
      ) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [seek, isPlaying]);

  function togglePlay() {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
    resetControlsTimeout();
  }

  function seek(seconds: number) {
    if (!videoRef.current) return;
    const vid = videoRef.current;
    // Use the video element's own duration — avoids being blocked by stale
    // React state which stays 0 until metadata loads for local files
    const cap = isFinite(vid.duration) ? vid.duration : Infinity;
    vid.currentTime = Math.max(0, Math.min(cap, vid.currentTime + seconds));
    setCurrentTime(vid.currentTime);
    resetControlsTimeout();
  }

  const handleTimelineScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const targetVal = parseFloat(e.target.value);
    videoRef.current.currentTime = targetVal;
    setCurrentTime(targetVal);
    resetControlsTimeout();
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    resetControlsTimeout();
  };

  const handleFullscreen = () => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen();
      }
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
      setIsFullscreen(false);
    }
    resetControlsTimeout();
  };

  const getAspectClass = () => {
    switch (aspect) {
      case 'fill': return 'object-cover w-full h-fullScale';
      case 'stretch': return 'object-fill w-full h-full';
      case 'zoom': return 'scale-125 object-cover w-full h-full transition-transform duration-500';
      case 'fit':
      default:
        return 'object-contain w-full h-full';
    }
  };

  const formatTime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);

    const pad = (n: number) => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };

  return (
    // On Android the useEffect above launches ExoPlayer and this component
    // must not render its web overlay on top of it.
    Capacitor.isNativePlatform() ? null :
    <div
      id="mpv-video-player-container"
      ref={containerRef}
      onMouseMove={resetControlsTimeout}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      className="fixed inset-0 bg-black z-50 flex items-center justify-center select-none overflow-hidden"
    >
      {/* Target Video Output render */}
      {videoSrc && !Capacitor.isNativePlatform() && (
        <video
          id="native-html-video-element"
          ref={videoRef}
          autoPlay
          className={`h-full w-full pointer-events-none transition-all ${getAspectClass()}`}
          style={{ transformOrigin: 'center' }}
        />
      )}

      {/* Styled Customizable Subtitles Overlay */}
      {subText && (
        <div id="subtitles-viewport" className="absolute bottom-20 left-1/2 -translate-x-1/2 max-w-2xl text-center pointer-events-none z-40 px-4 transition-all duration-300">
          <p
            id="rendering-subtitle-p"
            style={{
              fontSize: `${settings.subtitleSize}px`,
              color: settings.subtitleColor,
              backgroundColor: settings.subtitleBackgroundColor,
              textShadow: '0 2px 4px rgba(0,0,0,0.9), 0 -1px 2px rgba(0,0,0,0.9)',
            }}
            className="px-4 py-2 rounded-lg font-medium leading-relaxed font-sans"
          >
            {subText}
          </p>
        </div>
      )}

      {/* MPV System Stat Lines / Codec Alert banner */}
      {codecAlert && (
        <div id="codec-warning-hud" className="absolute top-4 left-4 bg-zinc-950/90 border border-amber-500/30 text-amber-500 px-3 py-1.5 rounded text-xs font-mono tracking-wide z-40 flex items-center gap-2 animate-pulse">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          <span>{codecAlert}</span>
        </div>
      )}

      {/* Hover/Move UI Controls Wrapper */}
      <div
        id="controls-touch-overlay"
        onClick={togglePlay}
        className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/60 z-30 transition-opacity duration-500 flex flex-col justify-between p-6 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* TOP BAR controls */}
        <div className="flex justify-between items-center" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3">
            <button
              id="player-back-trigger"
              onClick={onClose}
              className="p-2 hover:bg-zinc-800/80 rounded-full transition-all text-zinc-300 hover:text-white cursor-pointer"
            >
              <RotateCcw className="rotate-90" size={20} />
            </button>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-zinc-100 tracking-wide">{movie.title}</span>
              <span className="text-[11px] font-mono text-zinc-400">
                {(() => {
                  const epLabel = /^S\d{1,2}E\d{1,3}/i.exec(movie.tagline || '')?.[0]?.toUpperCase();
                  return epLabel ? `${epLabel} · ${movie.genres.join(' • ')}` : movie.genres.join(' • ');
                })()}
              </span>
            </div>
          </div>

          {/* Quick HUD specs */}
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded text-zinc-400 text-[10px]">
              {aspect.toUpperCase()} aspect
            </span>
            <span className="bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded text-zinc-400 text-[10px]">
              {speed}x speed
            </span>
          </div>
        </div>

        {/* MIDDLE CONTROLS - Seek Wheels and Play / Pause */}
        <div className="flex items-center justify-center gap-10" onClick={(e) => e.stopPropagation()}>
          <button
            id="player-seek-backward"
            onClick={() => seek(-10)}
            className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-full text-zinc-300 hover:text-white hover:bg-zinc-800/80 hover:scale-105 active:scale-95 transition-all cursor-pointer"
            title="Rewind 10 Seconds"
          >
            <SkipBack size={24} />
          </button>

          <button
            id="player-center-play-pause"
            onClick={togglePlay}
            className="p-6 bg-amber-500 hover:bg-amber-400 text-black rounded-full hover:scale-110 active:scale-95 transition-all shadow-[0_0_30px_rgba(245,158,11,0.4)] cursor-pointer"
          >
            {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" />}
          </button>

          <button
            id="player-seek-forward"
            onClick={() => seek(10)}
            className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-full text-zinc-300 hover:text-white hover:bg-zinc-800/80 hover:scale-105 active:scale-95 transition-all cursor-pointer"
            title="Fast Forward 10 Seconds"
          >
            <SkipForward size={24} />
          </button>
        </div>

        {/* BOTTOM TIMELINE AND CONTROL SLIDERS */}
        <div className="flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
          
          {/* Timeline slider row */}
          <div id="timeline-slider-row" className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-zinc-400 w-12 text-right">
              {formatTime(currentTime)}
            </span>
            
            <input
              id="player-duration-scrub"
              type="range"
              min={0}
              max={duration > 0 ? duration : (videoRef.current && isFinite(videoRef.current.duration) ? videoRef.current.duration : 100)}
              value={currentTime}
              onChange={handleTimelineScrub}
              className="flex-1 accent-amber-500 h-1 bg-zinc-800 rounded-lg cursor-pointer hover:h-1.5 transition-all focus:outline-none"
            />
            
            <span className="text-[11px] font-mono text-zinc-400 w-12">
              {formatTime(duration)}
            </span>
          </div>

          {/* Quick HUD Config tabs */}
          {activeTab && (
            <div className="self-end bg-zinc-950/95 border border-zinc-800 p-4 rounded-xl flex flex-col gap-3 text-xs w-72 backdrop-blur-3xl animate-in fade-in slide-in-from-bottom-3 shadow-2xl mb-2">
              {activeTab === 'subtitles' && (
                <>
                  <span className="font-bold text-zinc-300 uppercase tracking-widest text-[10px] border-b border-zinc-800 pb-1.5 mb-1 text-amber-500 flex items-center gap-1.5">
                    <Type size={12} /> Subtitle Formatting
                  </span>
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-400">Subtitle Size:</span>
                    <span className="font-mono text-zinc-100 font-semibold">{settings.subtitleSize}px</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-400">Text Target Color:</span>
                    <span className="flex items-center gap-1.5 font-mono text-zinc-100">
                      <span className="w-3 h-3 rounded-full border border-zinc-700" style={{backgroundColor: settings.subtitleColor}} />
                      {settings.subtitleColor}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-400">Outline contour:</span>
                    <span className="bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded text-zinc-300 font-mono">
                      Solid DropShadow
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-500 leading-tight">
                    * Subtitle parameters can be changed globally in the Strøm settings panel anytime.
                  </div>
                </>
              )}

              {activeTab === 'audio' && (
                <>
                  <span className="font-bold text-zinc-300 uppercase tracking-widest text-[10px] border-b border-zinc-800 pb-1.5 mb-1 text-amber-500 flex items-center gap-1.5">
                    <Sliders size={12} /> MPV Audio Preferences
                  </span>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-zinc-400">
                      <span>Sync Sync Delay:</span>
                      <span className="font-mono text-zinc-200">{audioDelay} ms</span>
                    </div>
                    <input
                      id="speed-audio-delay"
                      type="range"
                      min={-1000}
                      max={1000}
                      step={50}
                      value={audioDelay}
                      onChange={(e) => setAudioDelay(parseInt(e.target.value))}
                      className="accent-amber-500 h-1 bg-zinc-800 rounded-lg cursor-pointer"
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-400">Atmos Demuxer:</span>
                    <span className="text-emerald-400 font-medium">TrueHD 7.1 Passthrough</span>
                  </div>
                </>
              )}

            </div>
          )}

          {/* Operational Transport Triggers Row */}
          <div className="flex justify-between items-center">
            {/* Left sliders */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 group">
                <button
                  id="player-mute-toggle"
                  onClick={toggleMute}
                  className="p-2 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-lg transition-all cursor-pointer"
                >
                  {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <input
                  id="player-volume-scrub"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-20 accent-amber-500 h-1 bg-zinc-800 rounded-lg cursor-pointer focus:outline-none"
                />
              </div>

              {/* Loop of Aspect Ratio Fitting */}
              <button
                id="player-aspect-cycle"
                onClick={() => {
                  const aspects: PlayerSettings['aspectRatio'][] = ['fit', 'fill', 'stretch', 'zoom'];
                  const nextIdx = (aspects.indexOf(aspect) + 1) % aspects.length;
                  setAspect(aspects[nextIdx]);
                }}
                className="px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-mono font-medium rounded text-zinc-300 hover:text-white transition-all flex items-center gap-1 cursor-pointer"
              >
                <span>ASPECT:</span>
                <span className="text-amber-500 font-bold">{aspect.toUpperCase()}</span>
              </button>

              {/* Speed Controller Toggle */}
              <button
                id="player-speed-cycle"
                onClick={() => {
                  const speeds = [1.0, 1.25, 1.5, 2.0, 0.5];
                  const nextIdx = (speeds.indexOf(speed) + 1) % speeds.length;
                  setSpeed(speeds[nextIdx]);
                }}
                className="px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-mono font-medium rounded text-zinc-300 hover:text-white transition-all flex items-center gap-1 cursor-pointer"
              >
                <span>SPEED:</span>
                <span className="text-amber-500 font-bold">{speed}x</span>
              </button>
            </div>

            {/* Right parameter toggler HUD triggers */}
            <div className="flex items-center gap-2">
              <button
                id="tab-toggle-subtitles"
                onClick={() => setActiveTab(activeTab === 'subtitles' ? null : 'subtitles')}
                className={`p-2 rounded-lg transition-all flex items-center gap-1 text-[11px] font-mono ${
                  activeTab === 'subtitles' ? 'bg-amber-500 text-black font-semibold' : 'hover:bg-zinc-800 text-zinc-300'
                } cursor-pointer`}
              >
                <Type size={16} />
                <span className="hidden sm:inline">SUBTITLE HID</span>
              </button>

              <button
                id="tab-toggle-audio"
                onClick={() => setActiveTab(activeTab === 'audio' ? null : 'audio')}
                className={`p-2 rounded-lg transition-all flex items-center gap-1 text-[11px] font-mono ${
                  activeTab === 'audio' ? 'bg-amber-500 text-black font-semibold' : 'hover:bg-zinc-800 text-zinc-300'
                } cursor-pointer`}
              >
                <Sliders size={16} />
                <span className="hidden sm:inline">AUDIO SYNC</span>
              </button>

              <button
                id="player-fullscreen-toggle"
                onClick={handleFullscreen}
                className="p-2 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-lg transition-all cursor-pointer"
              >
                {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
