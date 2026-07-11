import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Play, Info, Settings, Laptop, Film, Plus, Trash2, FolderPlus, Compass, Users, Heart, ClipboardList, Database, Library, ArrowRight, Star, RefreshCw, Layers, Server, Zap, Download, X, ChevronDown, Tv } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { Movie, LibraryPath, LocalFile, PlaybackSession, PlayerSettings, TMDBConfig, TVDBConfig, TrackerRelease, TrackerCategory, TrackInfo } from './types';
import { getMovieDetails, parseMovieFilename, isTVEpisode, parseTVFilename } from './lib/tmdb';

// Modular Components
import CinemaVideoPlayer from './components/CinemaVideoPlayer';
import HeroBanner from './components/HeroBanner';
import MovieDetailsModal from './components/MovieDetailsModal';
import SettingsPanel from './components/SettingsPanel';
import Sidebar from './components/Sidebar';
import HoverPreviewCard from './components/HoverPreviewCard';
import { ActivePreviewProvider } from './components/ActivePreviewContext';
import StromLogo from './components/StromLogo';
import ConnectionGate from './components/ConnectionGate';
import EpisodeSelectModal from './components/EpisodeSelectModal';
import TrackPickerModal from './components/TrackPickerModal';
import QualityPickerModal from './components/QualityPickerModal';
import { parseEpisodesFromMovie, groupMoviesByShow, ParsedEpisode } from './lib/episodeUtils';

// Windows paths returned across different scans/caches can differ in slash
// direction (\ vs /) and drive-letter or segment casing even when they point
// at the exact same file — the codebase already normalizes this way in a
// dozen places before comparing paths (see the repeated `norm`/`normalize`
// helpers below). Session <-> Movie matching needs the same treatment: a
// raw `===` on localFilePath silently fails on Windows whenever the casing
// or slash style drifts between the scan that created the session and the
// scan that's currently in state, which is exactly what made "Continue
// Watching" cards unclickable while the same movie worked fine everywhere
// else (those other lookups go through this normalization already).
const normalizePath = (p?: string | null): string =>
  (p || '').toUpperCase().replace(/[\\/]+/g, '/').replace(/\/+$/, '');

// Individual TV episode Movie objects get a tagline like "S04E01 · Local TV
// Episode" written at scan time (see parseTVFilename call sites). Continue
// Watching, Recently Added, and the native/web player title overlays all
// want just the "S04E01" part on its own — this pulls it out once instead
// of every call site re-deriving/duplicating the regex.
const getEpisodeLabel = (movie?: { tagline?: string } | null): string | null => {
  const match = /^S\d{1,2}E\d{1,3}/i.exec(movie?.tagline || '');
  return match ? match[0].toUpperCase() : null;
};

// Host strings coming out of the ConnectionGate pairing/subnet-scan flow
// aren't guaranteed to be bare "host:port" — on at least one machine the
// scanner has handed back a value that already includes a scheme, and blindly
// prepending "http://" on top of that produced "http://http//1.2.3.4:5000/",
// which then turns every "${host}/api/..." call into a doubled, trailing-
// slashed URL that fails to resolve. Same idea as the TrackerFlix host's
// existing (but not shared) sanitizeHost helper below — strip any existing
// scheme before re-adding one, and drop trailing slashes so appending
// "/api/..." never produces a double slash.
const normalizeHost = (raw: string): string => {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
  return `http://${withoutScheme}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel components for infinite scroll
// ─────────────────────────────────────────────────────────────────────────────

interface SentinelProps {
  catKey: string;
  catLabel: string;
  exhausted?: boolean;
  loading?: boolean;
  onVisible: (catKey: string, catLabel: string) => void;
}

/**
 * HorizontalSentinel — placed at the end of a horizontal scroll row.
 * Uses IntersectionObserver on the scroll container's root so it fires
 * when the sentinel enters the horizontal viewport of the container.
 */
function HorizontalSentinel({ catKey, catLabel, exhausted, loading, onVisible }: SentinelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const calledRef = useRef(false);

  useEffect(() => {
    if (exhausted) return;
    const el = ref.current;
    if (!el) return;
    // Observe relative to the scrolling parent (the flex overflow-x container)
    const root = el.closest('[id^="tracker-scroller-"]') as HTMLElement | null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !calledRef.current) {
          calledRef.current = true;
          onVisible(catKey, catLabel);
          // Reset after a short delay so the next page can also trigger
          setTimeout(() => { calledRef.current = false; }, 1200);
        }
      },
      { root, threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [catKey, catLabel, exhausted, onVisible]);

  if (exhausted) return null;
  return (
    <div
      ref={ref}
      className="flex-shrink-0 flex items-center justify-center w-[80px] min-w-[80px]"
      aria-hidden
    >
      {loading && (
        <div className="w-5 h-5 rounded-full border-2 border-violet-500/40 border-t-violet-400 animate-spin" />
      )}
    </div>
  );
}

/**
 * VerticalSentinel — placed below a vertical grid.
 * Uses the default viewport as root (standard vertical page scroll).
 */
function VerticalSentinel({ catKey, catLabel, exhausted, loading, onVisible }: SentinelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const calledRef = useRef(false);

  useEffect(() => {
    if (exhausted) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !calledRef.current) {
          calledRef.current = true;
          onVisible(catKey, catLabel);
          setTimeout(() => { calledRef.current = false; }, 1200);
        }
      },
      { threshold: 0.1, rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [catKey, catLabel, exhausted, onVisible]);

  if (exhausted) return null;
  return (
    <div ref={ref} className="w-full flex items-center justify-center py-10" aria-hidden>
      {loading && (
        <div className="flex items-center gap-3 text-zinc-500">
          <div className="w-5 h-5 rounded-full border-2 border-violet-500/40 border-t-violet-400 animate-spin" />
          <span className="text-[10px] font-mono uppercase tracking-widest">Loading more…</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** Reads plexus_movie_overrides from localStorage and re-applies user edits
 *  (title, posterPath) onto a movie after TMDB enrichment, so manual overrides
 *  always survive rescans. Keyed by localFilePath to avoid server ID collisions. */
function applyLocalOverrides(movie: Movie): Movie {
  try {
    const all: Record<string, { title?: string; posterPath?: string }> =
      JSON.parse(localStorage.getItem('plexus_movie_overrides') || '{}');
    const ov = all[movie.localFilePath || movie.id];
    if (!ov) return movie;
    return {
      ...movie,
      ...(ov.title      ? { title:      ov.title }      : {}),
      ...(ov.posterPath ? { posterPath: ov.posterPath } : {}),
    };
  } catch {
    return movie;
  }
}

export default function App() {
  // --- CORE STATE ---
  const [recentlyAdded, setRecentlyAdded] = useState<Movie[]>([]);
  
  // Connection Gate states
  const [isGateClosed, setIsGateClosed] = useState<boolean>(() => {
    return localStorage.getItem('strom_gate_open_session') !== 'true';
  });
  const [connectedServerAddress, setConnectedServerAddress] = useState<string>(() => {
    return localStorage.getItem('strom_server_address') || '';
  });
  const [activeTab, setActiveTab] = useState<'home' | 'settings'>('home');
  const [showStreamingView, setShowStreamingView] = useState(false);
  
  // Sidebar State for keyboard and gamepad driven navigation
  const [isSidebarFocused, setIsSidebarFocused] = useState<boolean>(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState<boolean>(false);
  const [sidebarFocusIdx, setSidebarFocusIdx] = useState<number>(0);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);

  // Persistence local movies scanned state
  const [localScannedMovies, setLocalScannedMovies] = useState<Movie[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [playingMovie, setPlayingMovie] = useState<Movie | null>(null);
  const [currentHeroMovie, setCurrentHeroMovie] = useState<Movie | null>(null);

  // Library Pathways State
  const [libraryPaths, setLibraryPaths] = useState<LibraryPath[]>([]);

  // Playback History Sessions state for "Continue Watching" row
  const [playbackSessions, setPlaybackSessions] = useState<PlaybackSession[]>([]);

  // Config State
  const [playerSettings, setPlayerSettings] = useState<PlayerSettings>({
    useHardwareDecoding: true,
    aspectRatio: 'fit',
    subtitleSize: 22,
    subtitleColor: '#ffffff',
    subtitleBackgroundColor: 'rgba(0,0,0,0.6)',
    audioDelay: 0,
    playbackSpeed: 1.0,
    quality: 'auto',
  });

  const [tmdbConfig, setTmdbConfig] = useState<TMDBConfig>({
    apiKey: '',
    isEnabled: false,
    language: 'en-US',
  });

  const [tvdbConfig, setTvdbConfig] = useState<TVDBConfig>({
    apiKey: '',
    isEnabled: false,
    userKey: '',
  });

  const [primaryMetadataProvider, setPrimaryMetadataProvider] = useState<'tmdb' | 'tvdb'>('tmdb');

  // User upload reels state
  const [importedFiles, setImportedFiles] = useState<LocalFile[]>([]);
  const [localVideoFile, setLocalVideoFile] = useState<File | null>(null);

  // Windows Companion state variables
  const [companionHost, setCompanionHost] = useState<string>(
  normalizeHost(localStorage.getItem('plexus_companion_host') || 'localhost:5000')
);
  const [companionStatus, setCompanionStatus] = useState<'untested' | 'connecting' | 'connected' | 'failed'>('untested');
  const [companionScannedMovies, setCompanionScannedMovies] = useState<Movie[]>([]);

  // TrackerFlix state
  const [trackerFlixHost, setTrackerFlixHost] = useState<string>('http://localhost:3000');
  const [trackerFlixStatus, setTrackerFlixStatus] = useState<'untested' | 'connecting' | 'connected' | 'failed'>('untested');
  const [trackerCategories, setTrackerCategories] = useState<TrackerCategory[]>([]);
  const [trackerMovies, setTrackerMovies] = useState<Record<string, Movie[]>>({}); // key = category key

  // Streaming catalog (TMDB provider discover via TrackerFlix)
  const [streamingProviders, setStreamingProviders] = useState<{ id: number; name: string; logoPath: string }[]>([]);
  const [streamingMovies, setStreamingMovies] = useState<Movie[]>([]);
  const [streamingProviderId, setStreamingProviderId] = useState<number | null>(null);
  const [streamingPage, setStreamingPage] = useState(1);
  const [streamingTotalPages, setStreamingTotalPages] = useState(1);
  const [streamingLoading, setStreamingLoading] = useState(false);
  // Streaming view D-pad focus: 'filters' = top pill row, 'grid' = movie grid
  const [streamingFocusArea, setStreamingFocusArea] = useState<'filters' | 'grid'>('grid');
  const [streamingFilterIdx, setStreamingFilterIdx] = useState(0); // 0=All, 1..N=providers
  const [streamingGridRow, setStreamingGridRow] = useState(0);
  const [streamingGridCol, setStreamingGridCol] = useState(0);
  const STREAMING_COLS = 7; // matches xl:grid-cols-7
  // Category/library grid columns — fewer on Android TV due to WebView viewport behaviour
  const CAT_COLS = 6;
  const [selectedTrackerCategory, setSelectedTrackerCategory] = useState<string | null>(null);
  // Infinite scroll state — one entry per tracker category key
  const [categoryPages, setCategoryPages] = useState<Record<string, number>>({});          // last page fetched
  const [categoryLoadingMore, setCategoryLoadingMore] = useState<Record<string, boolean>>({});
  const [categoryExhausted, setCategoryExhausted] = useState<Record<string, boolean>>({});  // no more pages
  const [recentlyDownloaded, setRecentlyDownloaded] = useState<Movie[]>([]);
  // Quality picker state
  const [qualityPickerMovie, setQualityPickerMovie] = useState<Movie | null>(null);
  // Episode select modal state (TV shows with multiple episodes)
  const [episodeSelectShow, setEpisodeSelectShow] = useState<Movie | null>(null);
  // MPV external player state
  const [mpvLaunching, setMpvLaunching] = useState<boolean>(false);
  const [mpvError, setMpvError] = useState<string | null>(null);

  // Prefetched track info for local files — keyed by movie.id
  // Populated by HoverPreviewCard when a card becomes active (hover/focus)
  const [prefetchedTracks, setPrefetchedTracks] = useState<Record<string, TrackInfo>>({});

  // Track selections live inside MovieDetailsModal as local state.
  // No lifted state needed here — values are passed directly to onPlayClick.
  // TrackPickerModal can intercept before MPV launches (torrents only)
  const [pendingPlay, setPendingPlay] = useState<{ movie: Movie; tracks: TrackInfo } | null>(null);

  // Buffering overlay state
  const [bufferingMovie, setBufferingMovie] = useState<Movie | null>(null);
  const [bufferingPhase, setBufferingPhase] = useState<string>('');
  const [bufferingPct, setBufferingPct] = useState<number>(0);
  const [bufferingSpeed, setBufferingSpeed] = useState<string>('');
  const [bufferingPeers, setBufferingPeers] = useState<number>(0);
  const trackerSSERef = useRef<EventSource | null>(null);

  // --- ANDROID TV BOX D-PAD NAVIGATION STATE ---
  const [isTvMode, setIsTvMode] = useState<boolean>(true);
  const [targetPlatform, setTargetPlatform] = useState<'windows' | 'android-tv' | 'tizen-tv'>(() => {
    // Always use android-tv mode when running as a native Android app
    if (Capacitor.isNativePlatform()) return 'android-tv';
    return (localStorage.getItem('strom_target_platform') as 'windows' | 'android-tv' | 'tizen-tv') || 'windows';
  });

  const updateTargetPlatform = (platform: 'windows' | 'android-tv' | 'tizen-tv') => {
    setTargetPlatform(platform);
    localStorage.setItem('strom_target_platform', platform);
    setIsTvMode(platform !== 'windows');
  };

  // Synchronize target platform mode on startup
  useEffect(() => {
    const saved = localStorage.getItem('strom_target_platform') as 'windows' | 'android-tv' | 'tizen-tv' | null;
    if (saved) {
      setTargetPlatform(saved);
      setIsTvMode(saved !== 'windows');
    }
  }, []);

  // ── Android hardware back button ───────────────────────────────────────────
  // Dismisses overlays in priority order. If nothing is open, minimizes the
  // app instead of exiting (Android TV / phone convention).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handler = CapacitorApp.addListener('backButton', () => {
      // 1. Video player open → close player
      if (playingMovie) { setPlayingMovie(null); return; }
      // 2. Track picker (pending play) → dismiss
      if (pendingPlay) { setPendingPlay(null); return; }
      // 3. Quality picker → dismiss
      if (qualityPickerMovie) { setQualityPickerMovie(null); return; }
      // 4. Episode select → dismiss
      if (episodeSelectShow) { setEpisodeSelectShow(null); return; }
      // 5. Movie details modal → dismiss
      if (selectedMovie) { setSelectedMovie(null); return; }
      // 6. Streaming view → back to home
      if (showStreamingView) { setShowStreamingView(false); return; }
      // 7. Tracker category view → back to home
      if (selectedTrackerCategory) { setSelectedTrackerCategory(null); return; }
      // 8. Library path filter → back to home
      if (selectedPathId) { setSelectedPathId(null); return; }
      // 8. Settings tab → back to home
      if (activeTab === 'settings') { setActiveTab('home'); return; }
      // 9. Sidebar open → close it
      if (isSidebarExpanded) { setIsSidebarExpanded(false); setIsSidebarFocused(false); return; }
      // 10. Nothing open → minimize (don't kill the app)
      CapacitorApp.minimizeApp();
    });

    return () => { handler.then(h => h.remove()); };
  }, [
    playingMovie, pendingPlay, qualityPickerMovie, episodeSelectShow,
    selectedMovie, showStreamingView, selectedTrackerCategory, selectedPathId,
    activeTab, isSidebarExpanded,
  ]);
  // ──────────────────────────────────────────────────────────────────────────
  
  // Realtime clock state for Immersive HUD
  const [hudTime, setHudTime] = useState<string>('12:00 PM');
  useEffect(() => {
    const updateHudTime = () => {
      const now = new Date();
      setHudTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateHudTime();
    const timer = setInterval(updateHudTime, 15000);
    return () => clearInterval(timer);
  }, []);
  
  // Highlighting grid parameters
  // Row indexing: 
  // 0 -> Navigation Header Tabs (Home, Settings)
  // 1 -> Hero Spotlight Action Buttons (Play, Movie Info)
  // 2 -> "Continue Watching" Row (if items present)
  // 3 -> "Trending & Blockbuster" Row
  // 4 -> "Scanned Local Library" Row
  const [focusRow, setFocusRow] = useState<number>(1);
  const [focusCol, setFocusCol] = useState<number>(0);

  // Load persistence configurations on mount AND whenever the gate closes.
  // Running on isGateClosed ensures boot() fires with the correct companionHost
  // after a link-code or manual-IP connection, not just on cold start when the
  // host isn't in localStorage yet.
  useEffect(() => {
    if (isGateClosed) return; // gate still open — host not known yet, skip
    const boot = async () => {
      // --- SETTINGS (stay in localStorage — device-specific, not library data) ---

      // 1. Player config
      const settingsRaw = localStorage.getItem('plexus_player_settings');
      if (settingsRaw) setPlayerSettings(JSON.parse(settingsRaw));

      // 2. TMDB credentials
      // No system-wide key is baked in — each install must supply its own free
      // TMDB API key via Settings. Prevents every user sharing one rate-limited key.
      const tmdbRaw = localStorage.getItem('plexus_tmdb_settings');
      if (tmdbRaw) {
        const parsed = JSON.parse(tmdbRaw);
        setTmdbConfig(parsed);
      } else {
        const defaultTMDB = { apiKey: '', isEnabled: false, language: 'en-US' };
        setTmdbConfig(defaultTMDB);
        localStorage.setItem('plexus_tmdb_settings', JSON.stringify(defaultTMDB));
      }

      // 3. TVDB credentials & primary provider
      const tvdbRaw = localStorage.getItem('plexus_tvdb_settings');
      if (tvdbRaw) setTvdbConfig(JSON.parse(tvdbRaw));
      const providerRaw = localStorage.getItem('plexus_primary_metadata_provider');
      if (providerRaw) setPrimaryMetadataProvider(providerRaw as 'tmdb' | 'tvdb');

      // 4. Companion host
      // On first run after linking, onConnected() has already written both
      // plexus_companion_host and strom_server_address to localStorage before
      // boot() re-runs (isGateClosed flipped to false). So hostRaw will be set.
      // hostRaw is re-normalized here (not just trusted as-is) so a value that
      // got corrupted by the old unguarded `http://${addr}` construction (now
      // fixed at the source in onConnected below) self-heals on the next boot
      // instead of being stuck malformed in localStorage forever.
      const hostRawStored = localStorage.getItem('plexus_companion_host');
      const hostRaw = hostRawStored ? normalizeHost(hostRawStored) : null;
      if (hostRaw && hostRaw !== hostRawStored) {
        localStorage.setItem('plexus_companion_host', hostRaw);
      }
      const gateAddr = localStorage.getItem('strom_server_address');
      const gateHost = gateAddr ? normalizeHost(gateAddr) : null;
      const activeHost = hostRaw || gateHost || companionHost;
      if (hostRaw) {
        setCompanionHost(hostRaw);
      } else if (gateHost) {
        setCompanionHost(gateHost);
        // Keep plexus_companion_host in sync so future boots don't need the fallback
        localStorage.setItem('plexus_companion_host', gateHost);
      }

      // 3b. Server-side config (plexus-config.json, via the /setup page)
      // The setup page is the intended source of truth for API keys — it writes
      // to plexus-config.json on the server. Pull it in here and mirror it into
      // localStorage so every existing localStorage-based TMDB/TVDB read
      // elsewhere in this file picks it up without needing separate patches.
      if (activeHost) {
        try {
          const cfgRes = await fetch(`${activeHost}/api/setup`);
          if (cfgRes.ok) {
            const serverCfg = await cfgRes.json();

            if (typeof serverCfg.tmdbApiKey === 'string' && serverCfg.tmdbApiKey.trim()) {
              const existingTmdbRaw = localStorage.getItem('plexus_tmdb_settings');
              const existingTmdb = existingTmdbRaw ? JSON.parse(existingTmdbRaw) : {};
              const mergedTmdb: TMDBConfig = {
                ...existingTmdb,
                apiKey: serverCfg.tmdbApiKey.trim(),
                isEnabled: true,
                language: existingTmdb.language || 'en-US',
              };
              setTmdbConfig(mergedTmdb);
              localStorage.setItem('plexus_tmdb_settings', JSON.stringify(mergedTmdb));
            }

            if (typeof serverCfg.tvdbApiKey === 'string' && serverCfg.tvdbApiKey.trim()) {
              const existingTvdbRaw = localStorage.getItem('plexus_tvdb_settings');
              const existingTvdb = existingTvdbRaw ? JSON.parse(existingTvdbRaw) : {};
              const mergedTvdb: TVDBConfig = {
                ...existingTvdb,
                apiKey: serverCfg.tvdbApiKey.trim(),
                isEnabled: true,
              };
              setTvdbConfig(mergedTvdb);
              localStorage.setItem('plexus_tvdb_settings', JSON.stringify(mergedTvdb));
            }
          }
        } catch (err) {
          // Server may be unreachable on this boot pass — fall back silently
          // to whatever is already in localStorage (handled above).
          console.warn('[Plexus] Could not load server config from /api/setup:', err);
        }
      }

      // 4b. TrackerFlix host — load and auto-connect
      const tfHostRaw = localStorage.getItem('plexus_trackerflix_host');
      const sanitizeHost = (h: string) => {
        if (!h) return 'http://localhost:3000';
        if (!/^https?:\/\//.test(h)) return `http://${h}`;
        return h.replace(/\/$/, '');
      };
      const tfHost = sanitizeHost(tfHostRaw || '');
      if (tfHostRaw) {
        const clean = sanitizeHost(tfHostRaw);
        setTrackerFlixHost(clean);
        localStorage.setItem('plexus_trackerflix_host', clean);
      }

      // Auto-connect TrackerFlix in background (catalog can take 30s to build)
      if (tfHost) {
        setTrackerFlixStatus('connecting');
        (async () => {
          try {
            const res = await fetch(`${tfHost}/api/catalog`);
            if (!res.ok) { setTrackerFlixStatus('failed'); return; }
            const text = await res.text();
            let data: any;
            try { data = JSON.parse(text); } catch {
              console.error('[TrackerFlix] Boot catalog not JSON:', text.slice(0, 200));
              setTrackerFlixStatus('failed');
              return;
            }
            setTrackerFlixStatus('connected');
            parseCatalogData(data);

            // Fetch streaming providers + first page of catalog
            try {
              const provRes = await fetch(`${tfHost}/api/tmdb/providers`);
              if (provRes.ok) {
                const provData = await provRes.json();
                setStreamingProviders(provData.providers || []);
              }
              const streamRes = await fetch(`${tfHost}/api/tmdb/catalog?page=1`);
              if (streamRes.ok) {
                const streamData = await streamRes.json();
                setStreamingMovies((streamData.results || []).map((item: any) => mapStreamingItem(item)));
                setStreamingTotalPages(streamData.totalPages || streamData.total_pages || 1);
              }
            } catch (err) {
              console.warn('[TrackerFlix] Streaming catalog fetch failed:', err);
            }
          } catch {
            setTrackerFlixStatus('failed');
          }
        })();
      }

      // --- LIBRARY DATA (loaded from library-cache.json on the companion server) ---
      let lib: Record<string, any> = {};
      try {
        const res = await fetch(`${activeHost}/api/library`);
        if (res.ok) lib = await res.json();
      } catch {
        // Server offline — fall back to localStorage for each library key
        ['plexus_playback_sessions','plexus_library_paths','plexus_scanned_local_movies',
         'plexus_imported_files','plexus_companion_movies'].forEach(k => {
          const v = localStorage.getItem(k);
          if (v) lib[k] = JSON.parse(v);
        });
      }

      // 5. Playback sessions
      if (lib.plexus_playback_sessions) {
        setPlaybackSessions(lib.plexus_playback_sessions);
      }

      // 6. Library paths
      if (lib.plexus_library_paths && lib.plexus_library_paths.length > 0) {
        setLibraryPaths(lib.plexus_library_paths);
      } else {
        const defaultPaths: LibraryPath[] = [
          { id: 'path-movies', path: 'D:\\Media\\Movies', deviceType: 'internal', category: 'Movies', fileCount: 12, scannedAt: new Date().toLocaleString() },
          { id: 'path-tvshows', path: 'D:\\Media\\Tv-shows', deviceType: 'internal', category: 'Tv-shows', fileCount: 4, scannedAt: new Date().toLocaleString() }
        ];
        setLibraryPaths(defaultPaths);
      }

      // 7. Local scanned movies
      if (lib.plexus_scanned_local_movies) {
        setLocalScannedMovies(lib.plexus_scanned_local_movies);
      }

      // 8. Imported files
      if (lib.plexus_imported_files) setImportedFiles(lib.plexus_imported_files);

      // 9. Companion movies — show cached data immediately as optimistic UI,
      // then always do a fresh fetch from /api/movies to catch additions/removals.
      // We never re-enrich the stale cache — that would miss deleted files.
      if (lib.plexus_companion_movies && lib.plexus_companion_movies.length > 0) {
        const parsed: Movie[] = lib.plexus_companion_movies;
        setCompanionScannedMovies(parsed);
        const sorted = [...parsed].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, 10);
        setRecentlyAdded(sorted);
        if (parsed.length > 0) setCurrentHeroMovie(parsed[0]);
      }

      // Always rescan from the server in the background so the catalog reflects
      // the actual files on disk (handles added AND removed files).
      if (activeHost) {
        setTimeout(async () => {
          try {
            const moviesRes = await fetch(`${activeHost}/api/movies`);
            if (!moviesRes.ok) return;
            const data = await moviesRes.json();
            if (!data?.movies?.length) return;

            const rawTmdb = localStorage.getItem('plexus_tmdb_settings');
            const rawTvdb = localStorage.getItem('plexus_tvdb_settings');
            const rawProvider = localStorage.getItem('plexus_primary_metadata_provider');
            const lsTmdb: TMDBConfig = rawTmdb ? JSON.parse(rawTmdb) : { apiKey: '', isEnabled: false, language: 'en-US' };
            const lsTvdb: TVDBConfig = rawTvdb ? JSON.parse(rawTvdb) : { apiKey: '', isEnabled: false };
            const lsProvider = (rawProvider as 'tmdb' | 'tvdb') || 'tmdb';

            let tvdbToken: string | null = null;
            if (lsTvdb.isEnabled && lsTvdb.apiKey) tvdbToken = await getTVDBToken(lsTvdb.apiKey);

            // Load the already-cached enriched movies so we can reuse metadata
            // for files that haven't changed — skipping redundant TMDB calls.
            const existingCache: Movie[] = lib.plexus_companion_movies || [];
            const cacheByPath = new Map<string, Movie>(
              existingCache.map(m => [((m.localFilePath || '') as string).toUpperCase(), m])
            );

            const results: Movie[] = [];
            for (const m of data.movies) {
              const cachedEntry = cacheByPath.get((m.filePath || '').toUpperCase());
              const hasTmdbPoster = cachedEntry?.posterPath && !cachedEntry.posterPath.includes('unsplash.com');

              // Reuse cached enriched data if the file path matches and poster is real
              if (cachedEntry && hasTmdbPoster) {
                // Keep the cached enriched entry but refresh stream URL (host may have changed)
                results.push(applyLocalOverrides({ ...cachedEntry, trailerUrl: m.streamUrl }));
                continue;
              }

              // Otherwise build fresh and enrich
              const isTV = isTVEpisode(m.fileName || '');
              let searchTitle: string; let searchYear: string | null;
              if (isTV) { const tvInfo = parseTVFilename(m.fileName || ''); searchTitle = tvInfo.title; searchYear = null; }
              else { const p = parseMovieFilename(m.fileName || m.title || ''); searchTitle = p.title; searchYear = p.year; }
              const parentDir = m.filePath ? m.filePath.replace(/[/\\][^/\\]+$/, '') : '';
              const base: Movie = {
                id: m.id || `local-${Math.random()}`,
                title: searchTitle || m.title || m.fileName || 'Unknown',
                backdropPath: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1600&q=80',
                posterPath: 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?auto=format&fit=crop&w=500&q=80',
                overview: `Local file: ${m.filePath || m.fileName}`, rating: 0,
                releaseDate: searchYear ? `${searchYear}-01-01` : new Date().toISOString().split('T')[0],
                runtime: isTV ? 45 : 120, genres: isTV ? ['TV Series'] : ['Local Video'],
                isLocal: true, localFilePath: m.filePath, fileSize: m.fileSize, fileType: m.fileType,
                trailerUrl: m.streamUrl, addedAt: m.addedAt ?? 0, sourcePath: parentDir,
              };
              let enriched2: Partial<Movie> | null = null;
              if (lsProvider === 'tmdb' && lsTmdb.isEnabled && lsTmdb.apiKey) {
                enriched2 = await enrichFromTMDB(searchTitle, searchYear, lsTmdb.apiKey, isTV);
                if (!enriched2 && lsTvdb.isEnabled && tvdbToken) enriched2 = await enrichFromTVDB(searchTitle, searchYear, tvdbToken);
              } else if (lsProvider === 'tvdb' && lsTvdb.isEnabled && tvdbToken) {
                enriched2 = await enrichFromTVDB(searchTitle, searchYear, tvdbToken);
                if (!enriched2 && lsTmdb.isEnabled && lsTmdb.apiKey) enriched2 = await enrichFromTMDB(searchTitle, searchYear, lsTmdb.apiKey, isTV);
              } else if (lsTmdb.isEnabled && lsTmdb.apiKey) {
                enriched2 = await enrichFromTMDB(searchTitle, searchYear, lsTmdb.apiKey, isTV);
              }
              if (enriched2) {
                if (isTV) { const tvInfo = parseTVFilename(m.fileName || ''); base.tagline = `S${String(tvInfo.season).padStart(2,'0')}E${String(tvInfo.episode).padStart(2,'0')} · Local TV Episode`; }
                Object.assign(base, { ...enriched2, isLocal: true, localFilePath: m.filePath, fileSize: m.fileSize, fileType: m.fileType, trailerUrl: m.streamUrl, addedAt: m.addedAt ?? 0, sourcePath: parentDir, id: base.id });
              }
              results.push(applyLocalOverrides(base));
            }

            setCompanionScannedMovies(results);
            await fetch(`${activeHost}/api/library`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ plexus_companion_movies: results })
            }).catch(() => {});
            const sortedNew = [...results].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, 10);
            setRecentlyAdded(sortedNew);
            if (results.length > 0) setCurrentHeroMovie(results[0]);
          } catch (err) {
            console.warn('[Plexus] Boot background rescan failed:', err);
          }
        }, 800);
      }
      // Migration: nuke any leftover localStorage library keys now that the
      // file is the source of truth. Safe to run every boot — removeItem is a no-op
      // if the key doesn't exist.
      if (Object.keys(lib).length > 0) {
        LIBRARY_KEYS.forEach(k => localStorage.removeItem(k));
      }
    };

    boot();
  }, [isGateClosed]);

  const LIBRARY_KEYS = [
    'plexus_companion_movies',
    'plexus_library_paths',
    'plexus_scanned_local_movies',
    'plexus_imported_files',
    'plexus_playback_sessions',
  ];

  // --- FILE-BASED LIBRARY STORAGE HELPERS ---
  // Saves library data to library-cache.json on the companion server.
  // On success, removes the same keys from localStorage so there's no stale copy.
  // Falls back to localStorage silently if the server is unreachable.
  const saveLibrary = async (patch: Record<string, any>) => {
    try {
      const res = await fetch(`${companionHost}/api/library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (res.ok) {
        // Nuke the localStorage copies so only the file is the source of truth
        Object.keys(patch).forEach(k => localStorage.removeItem(k));
        return;
      }
    } catch {}
    // Server offline — fall back to localStorage
    Object.entries(patch).forEach(([k, v]) =>
      localStorage.setItem(k, JSON.stringify(v))
    );
  };

  const loadLibrary = async (): Promise<Record<string, any>> => {
    try {
      const res = await fetch(`${companionHost}/api/library`);
      if (res.ok) return await res.json();
    } catch {}
    return {};
  };

  // On Android — call StromPlayer directly (ExoPlayer). Never mounts CinemaVideoPlayer.
  const playNative = async (movie: Movie, startTime?: number, audioTrack: number = -1, subtitleTrack: number = -1) => {
    const host = normalizeHost(localStorage.getItem('plexus_companion_host') || 'localhost:5000');
    const filePath = movie.localFilePath || movie.sourcePath || '';
    const streamUrl = filePath
      ? `${host}/api/stream?path=${encodeURIComponent(filePath)}`
      : movie.trailerUrl || '';
    if (!streamUrl) return;

    const StromPlayer = (window as any).Capacitor?.Plugins?.StromPlayer;
    if (!StromPlayer) return;

    const episodeLabel = getEpisodeLabel(movie);

    // StromPlayer.play() now resolves once the user backs out of PlayerActivity
    // (Capacitor's @ActivityCallback keeps the call alive across the native
    // screen). No more event listener / race condition — the promise itself
    // is the signal that playback ended, with the exit position attached.
    const result = await StromPlayer.play({
      url:          streamUrl,
      title:        movie.title,
      episodeLabel: episodeLabel ?? '',
      audioTrack,
      subtitleTrack,
      startTimeMs:  Math.floor((startTime ?? 0) * 1000),
    });

    const positionSec = Math.floor((result?.positionMs ?? 0) / 1000);
    const durationSec = (result?.durationMs ?? 0) > 0 ? Math.floor(result.durationMs / 1000) : 0;
    // Threshold matches MovieDetailsModal's hasResume check (currentTime > 30) —
    // saving below that just leaves a Continue Watching card with no way to
    // actually resume, since the modal won't show the button for it.
    const nearEnd = durationSec > 0 && (durationSec - positionSec) < 60;
    if (positionSec > 30 && !nearEnd) {
      updateSession({
        movieId:      movie.id,
        localFilePath: movie.localFilePath || movie.sourcePath || undefined,
        title:        movie.title,
        posterPath:   movie.posterPath ?? '',
        backdropPath: movie.backdropPath ?? movie.posterPath ?? '',
        currentTime:  positionSec,
        duration:     durationSec,
        lastPlayedAt: new Date().toISOString(),
      });
    } else if (nearEnd) {
      // Finished — remove any existing session for this title. Match by
      // localFilePath when we have one (it's stable across id drift between
      // Movie sources); fall back to movieId only for items with no path.
      setPlaybackSessions(prev => {
        const path = movie.localFilePath || movie.sourcePath || '';
        const updated = prev.filter(s => (path && s.localFilePath ? normalizePath(s.localFilePath) !== normalizePath(path) : s.movieId !== movie.id));
        saveLibrary({ plexus_playback_sessions: updated });
        return updated;
      });
    }
  };

    // Launch a local file OR remote stream URL in MPV via the companion server
  const playWithMPV = async (movie: Movie, startTime?: number, audioTrack?: number | null, subtitleTrack?: number | null) => {
    // Prefer direct file path — bypasses FFmpeg remux entirely for best quality.
    // Fall back to trailerUrl (HLS stream) only when no file path is available.
    const streamTarget = movie.localFilePath || movie.sourcePath || movie.trailerUrl;
    if (!streamTarget) {
      setMpvError('No playable source found for this title.');
      return;
    }

    const host = normalizeHost(localStorage.getItem('plexus_companion_host') || 'localhost:5000');
    setMpvLaunching(true);
    setMpvError(null);

    try {
      const res = await fetch(`${host}/api/play/local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: streamTarget,
          startTime: startTime ?? 0,
          audioTrack: audioTrack ?? null,
          subtitleTrack: subtitleTrack ?? null,
          movieId: movie.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMpvError(data.error || 'MPV failed to launch.');
      } else {
        watchMpvSession(movie, host);
      }
    } catch (err) {
      setMpvError('Could not reach companion server.');
    } finally {
      setMpvLaunching(false);
    }
  };

  // Polls the companion server while mpv is open. When mpv closes, grabs the
  // last known position and saves/updates a PlaybackSession — the same store
  // MovieDetailsModal already reads for the "Resume {time}" button. Mirrors
  // the "finished vs still-watching" threshold used in the Android path above.
  const mpvPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchMpvSession = (movie: Movie, host: string) => {
    if (mpvPollRef.current) clearInterval(mpvPollRef.current);

    mpvPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${host}/api/play/status`);
        if (!res.ok) return;
        const status = await res.json();
        if (status.playing) return; // still watching, keep polling

        // mpv has closed — stop polling and record the result once.
        if (mpvPollRef.current) { clearInterval(mpvPollRef.current); mpvPollRef.current = null; }

        const positionSec = Math.floor(status.position || 0);
        const durationSec = Math.floor(status.duration || 0);
        const nearEnd = durationSec > 0 && (durationSec - positionSec) < 60;

        if (positionSec > 30 && !nearEnd) {
          updateSession({
            movieId: movie.id,
            localFilePath: movie.localFilePath || movie.sourcePath || undefined,
            title: movie.title,
            posterPath: movie.posterPath ?? '',
            backdropPath: movie.backdropPath ?? movie.posterPath ?? '',
            currentTime: positionSec,
            duration: durationSec,
            lastPlayedAt: new Date().toISOString(),
          });
        } else if (nearEnd) {
          setPlaybackSessions(prev => {
            const path = movie.localFilePath || movie.sourcePath || '';
            const updated = prev.filter(s => (path && s.localFilePath ? normalizePath(s.localFilePath) !== normalizePath(path) : s.movieId !== movie.id));
            saveLibrary({ plexus_playback_sessions: updated });
            return updated;
          });
        }
      } catch {
        // companion server unreachable mid-poll — just try again next tick
      }
    }, 2000);
  };

  const updateSession = useCallback((newSession: PlaybackSession) => {
    setPlaybackSessions((prev) => {
      // Dedup by localFilePath when both sides have one — this is what
      // prevents the same file from spawning two Continue Watching entries
      // (or silently orphaning the old one) when its movieId has drifted
      // between a stale cached scan and a fresh one.
      const filtered = prev.filter((s) =>
        newSession.localFilePath && s.localFilePath
          ? normalizePath(s.localFilePath) !== normalizePath(newSession.localFilePath)
          : s.movieId !== newSession.movieId
      );
      const updated = [newSession, ...filtered].slice(0, 10);
      saveLibrary({ plexus_playback_sessions: updated });
      return updated;
    });
  }, [companionHost]);

  // Resolve the PlaybackSession for a given Movie. Prefers localFilePath —
  // the one identifier guaranteed to stay stable across rescans, whereas a
  // Movie's `id` can differ between companionScannedMovies (refreshed every
  // boot) and localScannedMovies (a persisted cache that isn't refreshed and
  // can retain an older id scheme for the same underlying file). Falls back
  // to movieId for items with no path (tracker/streaming entries).
  const findSessionForMovie = useCallback((movie: Movie | null | undefined): PlaybackSession | undefined => {
    if (!movie) return undefined;
    const path = movie.localFilePath || movie.sourcePath || '';
    if (path) {
      const normPath = normalizePath(path);
      const byPath = playbackSessions.find(s => s.localFilePath && normalizePath(s.localFilePath) === normPath);
      if (byPath) return byPath;
    }
    return playbackSessions.find(s => s.movieId === movie.id);
  }, [playbackSessions]);

  // Sync player updates helper
  const updatePlayerSettings = (newSettings: Partial<PlayerSettings>) => {
    const updated = { ...playerSettings, ...newSettings };
    setPlayerSettings(updated);
    localStorage.setItem('plexus_player_settings', JSON.stringify(updated));
  };

  // Sync TMDB config helper
  const updateTMDBConfig = (newConfig: Partial<TMDBConfig>) => {
    const updated = { ...tmdbConfig, ...newConfig };
    setTmdbConfig(updated);
    localStorage.setItem('plexus_tmdb_settings', JSON.stringify(updated));
  };

  // Sync TVDB config helper
  const updateTVDBConfig = (newConfig: Partial<TVDBConfig>) => {
    const updated = { ...tvdbConfig, ...newConfig };
    setTvdbConfig(updated);
    localStorage.setItem('plexus_tvdb_settings', JSON.stringify(updated));
  };

  // Sync Primary Metadata Provider
  const updatePrimaryMetadataProvider = (provider: 'tmdb' | 'tvdb') => {
    setPrimaryMetadataProvider(provider);
    localStorage.setItem('plexus_primary_metadata_provider', provider);
  };

  // Windows Companion Host updaters & checkers
  const updateCompanionHost = (newHost: string) => {
    setCompanionHost(newHost);
    localStorage.setItem('plexus_companion_host', newHost);
    setCompanionStatus('untested');
  };

  // --- TRACKERFLIX FUNCTIONS ---

  // ── Movie override handler — syncs edits from EditMovieModal into all lists ──
  const handleMovieUpdate = (updated: Movie) => {
    setSelectedMovie(updated);
    setLocalScannedMovies(prev =>
      prev.map(m => m.id === updated.id ? { ...m, ...updated } : m)
    );
    setCompanionScannedMovies(prev =>
      prev.map(m => m.id === updated.id ? { ...m, ...updated } : m)
    );
    setTrackerMovies(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        next[key] = next[key].map(m => m.id === updated.id ? { ...m, ...updated } : m);
      }
      return next;
    });
    setRecentlyAdded(prev =>
      prev.map(m => m.id === updated.id ? { ...m, ...updated } : m)
    );
    if (currentHeroMovie?.id === updated.id) setCurrentHeroMovie(updated);
  };

  const updateTrackerFlixHost = (newHost: string) => {
    const clean = newHost.trim()
      ? (/^https?:\/\//.test(newHost.trim()) ? newHost.trim().replace(/\/$/, '') : `http://${newHost.trim().replace(/\/$/, '')}`)
      : 'http://localhost:3000';
    setTrackerFlixHost(clean);
    localStorage.setItem('plexus_trackerflix_host', clean);
    setTrackerFlixStatus('untested');
    setTrackerCategories([]);
    setTrackerMovies({});
  };

  // Maps a TMDB discover result (from /api/tmdb/catalog) to a Movie object
  const mapStreamingItem = (item: any): Movie => ({
    id: `streaming-${item.id || item.tmdbId}`,
    title: item.title || item.name || 'Unknown',
    backdropPath: item.backdrop || item.backdropPath || item.backdrop_path
      ? (item.backdrop || item.backdropPath || `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`)
      : 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1600&q=80',
    posterPath: item.poster || item.posterPath || item.poster_path
      ? (item.poster || item.posterPath || `https://image.tmdb.org/t/p/w500${item.poster_path}`)
      : 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?auto=format&fit=crop&w=500&q=80',
    overview: item.overview || item.description || '',
    rating: item.rating || item.vote_average || 0,
    releaseDate: item.releaseDate || item.release_date || (item.year ? `${item.year}-01-01` : ''),
    runtime: item.runtime || 0,
    genres: item.genres || [],
    tagline: item.tagline || '',
    isTrackerItem: true,
    trackerItemId: String(item.id || item.tmdbId),
    trackerCategory: 'streaming',
    trackerSeeders: undefined,
    trackerSize: undefined,
    trackerReleases: [],
  });

  // Fetch streaming catalog from TrackerFlix — called on provider change or page load
  const fetchStreamingCatalog = async (providerId: number | null, page: number) => {
    if (!trackerFlixHost) return;
    setStreamingLoading(true);
    try {
      const url = providerId
        ? `${trackerFlixHost}/api/tmdb/catalog?provider=${providerId}&page=${page}`
        : `${trackerFlixHost}/api/tmdb/catalog?page=${page}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const mapped = (data.results || []).map((item: any) => mapStreamingItem(item));
      setStreamingMovies(page === 1 ? mapped : prev => [...prev, ...mapped]);
      setStreamingTotalPages(data.totalPages || data.total_pages || 1);
      setStreamingPage(page);
    } catch (err) {
      console.warn('[Streaming] fetch failed:', err);
    } finally {
      setStreamingLoading(false);
    }
  };

  // Opens a streaming catalog movie: shows the modal immediately, then lazily
  // fetches bt4g releases from /api/tmdb/sources/:tmdbId and patches them in.
  const openStreamingMovie = async (movie: Movie) => {
    setSelectedMovie(movie);
    if (
      movie.trackerCategory === 'streaming' &&
      movie.trackerItemId &&
      (!movie.trackerReleases || movie.trackerReleases.length === 0)
    ) {
      try {
        const res = await fetch(`${trackerFlixHost}/api/tmdb/sources/${movie.trackerItemId}`);
        if (!res.ok) return;
        const data = await res.json();
        const releases = (data.releases || []).map((r: any) => ({
          id: String(r.id),
          label: [r.quality, r.codec, r.hdr].filter(Boolean).join(' · ') || r.quality || String(r.id),
          quality: r.quality || '',
          size: r.sizeHuman || r.size || '',
          seeders: r.seeders || 0,
        }));
        setSelectedMovie(prev =>
          prev && prev.trackerItemId === movie.trackerItemId
            ? { ...prev, trackerReleases: releases }
            : prev
        );
      } catch (err) {
        console.warn('[Streaming] sources fetch failed:', err);
      }
    }
  };

  // Shared item mapper — used by parseCatalogData AND the infinite-scroll loader
  const mapTrackerItem = (item: any, catKey: string, catLabel?: string): Movie => ({
    id: `tracker-${item.id}`,
    title: item.title || 'Unknown',
    backdropPath: item.backdrop || item.backdropPath || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1600&q=80',
    posterPath: item.poster || item.posterPath || 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?auto=format&fit=crop&w=500&q=80',
    overview: item.overview || item.description || '',
    rating: item.rating || 0,
    releaseDate: item.year ? `${item.year}-01-01` : '',
    runtime: item.runtime || 0,
    genres: item.genres?.length ? item.genres : [catLabel || catKey],
    tagline: item.tagline || '',
    isTrackerItem: true,
    trackerItemId: String(item.id),
    trackerCategory: catKey,
    trackerSeeders: item.seeders,
    trackerSize: item.size,
    trackerReleases: (item.releases || []).map((r: any) => ({
      id: String(r.id),
      label: r.label || r.quality || String(r.id),
      quality: r.quality || '',
      size: r.size || '',
      seeders: r.seeders || 0,
    })),
  });

  const parseCatalogData = (data: any) => {
    const cats: TrackerCategory[] = (data.categories || []).map((c: any) => ({
      key: c.key,
      label: c.label,
    }));
    setTrackerCategories(cats);

    const allMovies: Record<string, Movie[]> = {};
    for (const cat of data.categories || []) {
      allMovies[cat.key] = (cat.items || []).map((item: any) => mapTrackerItem(item, cat.key, cat.label));
    }
    setTrackerMovies(allMovies);

    // Reset infinite-scroll state for all categories when catalog refreshes
    const initPages: Record<string, number>  = {};
    const initLoading: Record<string, boolean> = {};
    const initExhausted: Record<string, boolean> = {};
    for (const cat of data.categories || []) {
      initPages[cat.key]     = 1;
      initLoading[cat.key]   = false;
      initExhausted[cat.key] = false;
    }
    setCategoryPages(initPages);
    setCategoryLoadingMore(initLoading);
    setCategoryExhausted(initExhausted);
  };

  // Fetches the next page for a tracker category and appends items
  const loadMoreCategory = useCallback(async (catKey: string, catLabel: string) => {
    if (categoryLoadingMore[catKey] || categoryExhausted[catKey]) return;
    setCategoryLoadingMore(prev => ({ ...prev, [catKey]: true }));
    const nextPage = (categoryPages[catKey] ?? 1) + 1;
    try {
      const res = await fetch(`${trackerFlixHost}/api/catalog/more?category=${encodeURIComponent(catKey)}&page=${nextPage}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const newItems: Movie[] = (data.items || []).map((item: any) => mapTrackerItem(item, catKey, catLabel));
      if (newItems.length === 0) {
        setCategoryExhausted(prev => ({ ...prev, [catKey]: true }));
      } else {
        setTrackerMovies(prev => ({
          ...prev,
          [catKey]: [...(prev[catKey] || []), ...newItems],
        }));
        setCategoryPages(prev => ({ ...prev, [catKey]: nextPage }));
      }
    } catch (err) {
      console.warn(`[loadMore] ${catKey} page ${nextPage} failed:`, err);
      setCategoryExhausted(prev => ({ ...prev, [catKey]: true }));
    } finally {
      setCategoryLoadingMore(prev => ({ ...prev, [catKey]: false }));
    }
  }, [categoryLoadingMore, categoryExhausted, categoryPages, trackerFlixHost]);

  const fetchTrackerCatalog = async (host: string) => {
    try {
      const res = await fetch(`${host}/api/catalog`);
      if (!res.ok) return;
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        console.error('[TrackerFlix] Catalog refresh not JSON. First 200 chars:', text.slice(0, 200));
        return;
      }
      parseCatalogData(data);
    } catch (err) {
      console.error('[TrackerFlix] Failed to fetch catalog:', err);
    }
  };

  const testTrackerFlixConnection = async () => {
    setTrackerFlixStatus('connecting');
    try {
      const res = await fetch(`${trackerFlixHost}/api/catalog`);
      if (!res.ok) { setTrackerFlixStatus('failed'); return; }
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        console.error('[TrackerFlix] Catalog response is not JSON. First 200 chars:', text.slice(0, 200));
        setTrackerFlixStatus('failed');
        return;
      }
      setTrackerFlixStatus('connected');
      parseCatalogData(data);
    } catch (e) {
      setTrackerFlixStatus('failed');
    }
  };

  // Poll active torrents every 3s for the Recently Downloaded row
  useEffect(() => {
    if (trackerFlixStatus !== 'connected') return;
    const poll = async () => {
      try {
        const [activeRes, completedRes] = await Promise.all([
          fetch(`${trackerFlixHost}/api/torrents/active`),
          fetch(`${trackerFlixHost}/api/completed`),
        ]);
        if (!activeRes.ok) return;
        const data = await activeRes.json();
        const completedMap: Record<string, { filePath: string; fileName: string }> =
          completedRes.ok ? await completedRes.json() : {};

        // Build reverse lookup: infoHash → itemId from completed torrents
        const hashToItemId: Record<string, string> = {};
        for (const [itemId, entry] of Object.entries(completedMap) as any) {
          if (entry.infoHash) hashToItemId[entry.infoHash] = itemId;
        }

        const seeding = (data.torrents || []).filter((t: any) =>
          t.status === 'seeding' || t.progress >= 1.0
        );
        const matched: Movie[] = seeding.map((t: any) => {
          // Try to find in catalog first for proper metadata
          const found = Object.values(trackerMovies).flat().find(m =>
            m.title.toLowerCase() === t.name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[._]/g, ' ').trim()
          );
          if (found) return found;
          // Use itemId from completed map if available, else fall back to infoHash
          const itemId = hashToItemId[t.infoHash] || t.infoHash;
          return {
            id: `downloaded-${t.infoHash}`,
            title: t.name.replace(/[._]/g, ' ').replace(/\.[^.]+$/, '').trim(),
            backdropPath: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1600&q=80',
            posterPath: 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?auto=format&fit=crop&w=500&q=80',
            overview: '',
            rating: 0,
            releaseDate: '',
            runtime: 0,
            genres: ['Downloaded'],
            isTrackerItem: true,
            trackerItemId: itemId,
            trackerInfHash: t.infoHash,
            trackerSize: (t.totalSize / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
          } as Movie;
        });
        setRecentlyDownloaded(matched.slice(0, 10));
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [trackerFlixStatus, trackerFlixHost, trackerMovies]);

  // Start SSE stream for a tracker item with a chosen release id
  const startTrackerPlay = (movie: Movie, releaseId: string) => {
    // Close any existing SSE
    if (trackerSSERef.current) {
      trackerSSERef.current.close();
      trackerSSERef.current = null;
    }

    setBufferingMovie(movie);
    setBufferingPhase('Connecting...');
    setBufferingPct(0);
    setQualityPickerMovie(null);

    const url = `${trackerFlixHost}/api/play/${releaseId}`;
    const es = new EventSource(url);
    trackerSSERef.current = es;

    // Store HLS url in ref so useEffect in player can pick it up after mount
    const hlsUrlRef = { current: '' };

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'phase') {
          setBufferingPhase(msg.label || '');
        } else if (msg.type === 'buffering') {
          setBufferingPct(msg.percentReady || 0);
          setBufferingSpeed(msg.dlspeedHuman || '');
          setBufferingPeers(msg.peers || 0);
          setBufferingPhase(`Buffering ${msg.percentReady || 0}%`);
        } else if (msg.type === 'ready') {
          es.close();
          trackerSSERef.current = null;
          setBufferingMovie(null);

          // Pick the best source for MPV in priority order:
          // 1. filePath  — torrent complete, MPV reads file directly (best quality)
          // 2. sidecarStreamUrl — torrent in-progress, sidecar blocks at frontier
          // 3. streamUrl — HLS fallback (should rarely be needed now)
          const hlsUrl = msg.streamUrl?.startsWith('http')
            ? msg.streamUrl
            : msg.streamUrl ? `${trackerFlixHost}${msg.streamUrl}` : null;

          const mpvTarget = msg.filePath
            ? { ...movie, localFilePath: msg.filePath, trailerUrl: msg.filePath }
            : msg.sidecarStreamUrl
              ? { ...movie, trailerUrl: msg.sidecarStreamUrl }
              : { ...movie, trailerUrl: hlsUrl };

          // If the ready event includes track data (Step 2), show the picker
          // before launching MPV. Otherwise launch immediately as before.
          const hasTracks =
            (msg.audioTracks?.length > 1) || (msg.subtitles?.length > 0);

          if (hasTracks) {
            // Show track picker on all platforms — Android passes selections to ExoPlayer,
            // Windows passes them to MPV.
            setPendingPlay({
              movie: mpvTarget,
              tracks: { audioTracks: msg.audioTracks ?? [], subtitles: msg.subtitles ?? [] },
            });
          } else if (targetPlatform === 'android-tv') {
            playNative(mpvTarget);
          } else {
            playWithMPV(mpvTarget);
          }
        } else if (msg.type === 'error') {
          es.close();
          trackerSSERef.current = null;
          setBufferingMovie(null);
          setBufferingPhase('');
          console.error('[TrackerFlix] SSE error:', msg.message);
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      trackerSSERef.current = null;
      setBufferingMovie(null);
    };
  };

  const testCompanionConnection = async () => {
    setCompanionStatus('connecting');
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${companionHost}/api/health`, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        setCompanionStatus('connected');
        // Auto-run scan too on successful connectivity
        triggerCompanionScan();
      } else {
        setCompanionStatus('failed');
      }
    } catch (e) {
      setCompanionStatus('failed');
    }
  };

  // --- METADATA ENRICHMENT FUNCTIONS ---

  async function getTVDBToken(apiKey: string): Promise<string | null> {
    try {
      const res = await fetch('https://api4.thetvdb.com/v4/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apikey: apiKey })
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.data?.token || null;
    } catch {
      return null;
    }
  }

  async function enrichFromTVDB(title: string, year: string | null, token: string): Promise<Partial<Movie> | null> {
    try {
      const res = await fetch(
        `https://api4.thetvdb.com/v4/search?query=${encodeURIComponent(title)}&type=movie`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const results = data.data || [];
      let hit = year ? results.find((r: any) => r.year === year) : null;
      if (!hit && results.length > 0) hit = results[0];
      if (!hit) return null;

      const makeAbs = (url: string) =>
        url?.startsWith('http') ? url : url ? `https://artworks.thetvdb.com${url}` : null;

      return {
        posterPath: makeAbs(hit.image_url) || undefined,
        backdropPath: makeAbs(hit.background_url) || undefined,
        overview: hit.overview || undefined,
        rating: hit.score ? Math.round(hit.score * 10) / 10 : undefined,
      };
    } catch {
      return null;
    }
  }

  async function enrichFromTMDB(
    title: string,
    year: string | null,
    apiKey: string,
    isTV = false
  ): Promise<Partial<Movie> | null> {
    try {
      const isV4 = apiKey.trim().startsWith('eyJ');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (isV4) headers['Authorization'] = `Bearer ${apiKey.trim()}`;

      const endpoint = isTV
        ? 'https://api.themoviedb.org/3/search/tv'
        : 'https://api.themoviedb.org/3/search/movie';

      const params = new URLSearchParams({ query: title });
      if (!isV4) params.set('api_key', apiKey.trim());
      if (year && !isTV) params.set('primary_release_year', year);

      console.log(`[TMDB] Searching: "${title}" isTV=${isTV}`);
      const res = await fetch(`${endpoint}?${params}`, { headers });
      console.log(`[TMDB] Response status: ${res.status}`);
      if (!res.ok) return null;

      const data = await res.json();
      const results = data.results || [];
      const hit = results[0];
      if (!hit) return null;

      console.log(`[TMDB] Hit: ${isTV ? hit.name : hit.title}`);

      const genresMap: Record<number, string> = {
        28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
        99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
        27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Science Fiction",
        10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
        10759: "Action & Adventure", 10765: "Sci-Fi & Fantasy", 10762: "Kids",
        10763: "News", 10764: "Reality", 10766: "Soap", 10767: "Talk", 10768: "War & Politics"
      };

      const genres: string[] = (hit.genre_ids || []).map((id: number) => genresMap[id]).filter(Boolean);

      const releaseDate = isTV ? hit.first_air_date : hit.release_date;

      return {
        id: String(hit.id),
        title: isTV ? hit.name : hit.title,
        backdropPath: hit.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${hit.backdrop_path}`
          : undefined,
        posterPath: hit.poster_path
          ? `https://image.tmdb.org/t/p/w500${hit.poster_path}`
          : undefined,
        overview: hit.overview || undefined,
        rating: hit.vote_average ? Math.round(hit.vote_average * 10) / 10 : undefined,
        releaseDate: releaseDate || undefined,
        genres: genres.length > 0 ? genres : undefined,
      };
    } catch {
      return null;
    }
  }

  async function enrichWithMetadata(
    rawMovies: any[],
    overrideTmdb?: TMDBConfig,
    overrideTvdb?: TVDBConfig,
    overrideProvider?: 'tmdb' | 'tvdb'
  ): Promise<Movie[]> {
    const useTmdb = overrideTmdb ?? tmdbConfig;
    const useTvdb = overrideTvdb ?? tvdbConfig;
    const useProvider = overrideProvider ?? primaryMetadataProvider;

    console.log(`[Enrich] Starting enrichment for ${rawMovies.length} movies. Provider: ${useProvider}, TMDB: ${useTmdb.isEnabled}, TVDB: ${useTvdb.isEnabled}`);

    let tvdbToken: string | null = null;
    if (useTvdb.isEnabled && useTvdb.apiKey) {
      tvdbToken = await getTVDBToken(useTvdb.apiKey);
    }

    const results: Movie[] = [];

    for (const m of rawMovies) {
      const isTV = isTVEpisode(m.fileName || '');
      let searchTitle: string;
      let searchYear: string | null;

      if (isTV) {
        const tvInfo = parseTVFilename(m.fileName || '');
        searchTitle = tvInfo.title;
        searchYear = null;
      } else {
        const parsed = parseMovieFilename(m.fileName || m.title || '');
        searchTitle = parsed.title;
        searchYear = parsed.year;
      }

      const parentDir = m.filePath
        ? m.filePath.replace(/[/\\][^/\\]+$/, '')
        : '';

      const base: Movie = {
        id: m.id || `local-${Date.now()}-${Math.random()}`,
        title: searchTitle || m.title || m.fileName || 'Unknown',
        backdropPath: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1600&q=80',
        posterPath: 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?auto=format&fit=crop&w=500&q=80',
        overview: `Local file: ${m.filePath || m.fileName}`,
        rating: 0,
        releaseDate: searchYear ? `${searchYear}-01-01` : new Date().toISOString().split('T')[0],
        runtime: isTV ? 45 : 120,
        genres: isTV ? ['TV Series'] : ['Local Video'],
        isLocal: true,
        localFilePath: m.filePath,
        fileSize: m.fileSize,
        fileType: m.fileType,
        trailerUrl: m.streamUrl,
        addedAt: m.addedAt ?? 0,
        sourcePath: parentDir,
      };

      let enriched: Partial<Movie> | null = null;

      if (useProvider === 'tmdb' && useTmdb.isEnabled && useTmdb.apiKey) {
        enriched = await enrichFromTMDB(searchTitle, searchYear, useTmdb.apiKey, isTV);
        if (!enriched && useTvdb.isEnabled && tvdbToken) {
          enriched = await enrichFromTVDB(searchTitle, searchYear, tvdbToken);
        }
      } else if (useProvider === 'tvdb' && useTvdb.isEnabled && tvdbToken) {
        enriched = await enrichFromTVDB(searchTitle, searchYear, tvdbToken);
        if (!enriched && useTmdb.isEnabled && useTmdb.apiKey) {
          enriched = await enrichFromTMDB(searchTitle, searchYear, useTmdb.apiKey, isTV);
        }
      } else if (useTmdb.isEnabled && useTmdb.apiKey) {
        enriched = await enrichFromTMDB(searchTitle, searchYear, useTmdb.apiKey, isTV);
      }

      if (enriched) {
        if (isTV) {
          const tvInfo = parseTVFilename(m.fileName || '');
          base.tagline = `S${String(tvInfo.season).padStart(2,'0')}E${String(tvInfo.episode).padStart(2,'0')} · Local TV Episode`;
        }
        // Merge enriched into base, keeping local file bindings
        Object.assign(base, {
          ...enriched,
          isLocal: true,
          localFilePath: m.filePath,
          fileSize: m.fileSize,
          fileType: m.fileType,
          trailerUrl: m.streamUrl,
          addedAt: m.addedAt ?? 0,
          sourcePath: parentDir,
          id: base.id, // keep our local id
        });
      }

      results.push(applyLocalOverrides(base));
    }

    return results;
  }

  const triggerCompanionScan = async () => {
    try {
      // POST library paths first — send full {path, category} objects so categories are preserved
      const pathsPayload = libraryPaths.map(p => ({ path: p.path, category: p.category || 'Movies' }));
      await fetch(`${companionHost}/api/paths`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: pathsPayload })
      });

      const res = await fetch(`${companionHost}/api/movies`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.movies) {
          const enriched = await enrichWithMetadata(data.movies);
          setCompanionScannedMovies(enriched);
          saveLibrary({ plexus_companion_movies: enriched });
          const sorted = [...enriched].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, 10);
          setRecentlyAdded(sorted);
          if (enriched.length > 0) setCurrentHeroMovie(enriched[0]);
        }
      }
    } catch (e) {
      console.error("Failed to query companion movies sync", e);
    }
  };

  // Auto test connection on start if host stored
  useEffect(() => {
    const storedRaw = localStorage.getItem('plexus_companion_host');
    const stored = storedRaw ? normalizeHost(storedRaw) : null;
    if (stored) {
      const pingStatus = async () => {
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), 2000);
          const res = await fetch(`${stored}/api/health`, { signal: controller.signal });
          clearTimeout(id);
          if (res.ok) {
            setCompanionStatus('connected');

            // Read configs from localStorage to avoid stale closure
            const rawTmdb = localStorage.getItem('plexus_tmdb_settings');
            const rawTvdb = localStorage.getItem('plexus_tvdb_settings');
            const rawProvider = localStorage.getItem('plexus_primary_metadata_provider');
            const lsTmdb: TMDBConfig = rawTmdb ? JSON.parse(rawTmdb) : { apiKey: '', isEnabled: false, language: 'en-US' };
            const lsTvdb: TVDBConfig = rawTvdb ? JSON.parse(rawTvdb) : { apiKey: '', isEnabled: false };
            const lsProvider = (rawProvider as 'tmdb' | 'tvdb') || 'tmdb';

            // POST library paths first — send {path, category} objects
            const rawPaths = localStorage.getItem('plexus_library_paths');
            const lsPaths: LibraryPath[] = rawPaths ? JSON.parse(rawPaths) : [];
            const pathObjects = lsPaths.map(p => ({ path: p.path, category: p.category || 'Movies' }));
            if (pathObjects.length > 0) {
              await fetch(`${stored}/api/paths`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: pathObjects })
              }).catch(() => {});
            }

            // Pull authoritative paths from server (may have been set via setup.html)
            try {
              const serverPathsRes = await fetch(`${stored}/api/paths`);
              if (serverPathsRes.ok) {
                const serverPathsData = await serverPathsRes.json();
                const serverPaths: Array<{ path: string; category: string }> = serverPathsData.paths || [];
                if (serverPaths.length > 0) {
                  // Merge: update categories on existing entries, add any new ones from server
                  const merged: LibraryPath[] = serverPaths.map(sp => {
                    const existing = lsPaths.find(lp => lp.path === sp.path);
                    return existing
                      ? { ...existing, category: sp.category }
                      : { id: `path-${Date.now()}-${Math.random().toString(36).slice(2)}`, path: sp.path, deviceType: 'custom' as const, category: sp.category, fileCount: 0, scannedAt: 'Never' };
                  });
                  setLibraryPaths(merged);
                  saveLibrary({ plexus_library_paths: merged });
                }
              }
            } catch (_) { /* server may not support GET /api/paths yet */ }

            const moviesRes = await fetch(`${stored}/api/movies`);
            if (moviesRes.ok) {
              const data = await moviesRes.json();
              if (data && data.movies) {
                const enriched = await (async () => {
                  const useTmdb = lsTmdb;
                  const useTvdb = lsTvdb;
                  const useProvider = lsProvider;
                  let tvdbToken: string | null = null;
                  if (useTvdb.isEnabled && useTvdb.apiKey) {
                    tvdbToken = await getTVDBToken(useTvdb.apiKey);
                  }
                  const results: Movie[] = [];
                  for (const m of data.movies) {
                    const isTV = isTVEpisode(m.fileName || '');
                    let searchTitle: string;
                    let searchYear: string | null;
                    if (isTV) {
                      const tvInfo = parseTVFilename(m.fileName || '');
                      searchTitle = tvInfo.title;
                      searchYear = null;
                    } else {
                      const parsedFn = parseMovieFilename(m.fileName || m.title || '');
                      searchTitle = parsedFn.title;
                      searchYear = parsedFn.year;
                    }
                    const parentDir = m.filePath ? m.filePath.replace(/[/\\][^/\\]+$/, '') : '';
                    const base: Movie = {
                      id: m.id || `local-${Math.random()}`,
                      title: searchTitle || m.title || m.fileName || 'Unknown',
                      backdropPath: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1600&q=80',
                      posterPath: 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?auto=format&fit=crop&w=500&q=80',
                      overview: `Local file: ${m.filePath || m.fileName}`,
                      rating: 0,
                      releaseDate: searchYear ? `${searchYear}-01-01` : new Date().toISOString().split('T')[0],
                      runtime: isTV ? 45 : 120,
                      genres: isTV ? ['TV Series'] : ['Local Video'],
                      isLocal: true,
                      localFilePath: m.filePath,
                      fileSize: m.fileSize,
                      fileType: m.fileType,
                      trailerUrl: m.streamUrl,
                      addedAt: m.addedAt ?? 0,
                      sourcePath: parentDir,
                    };
                    let enriched2: Partial<Movie> | null = null;
                    if (useProvider === 'tmdb' && useTmdb.isEnabled && useTmdb.apiKey) {
                      enriched2 = await enrichFromTMDB(searchTitle, searchYear, useTmdb.apiKey, isTV);
                      if (!enriched2 && useTvdb.isEnabled && tvdbToken) enriched2 = await enrichFromTVDB(searchTitle, searchYear, tvdbToken);
                    } else if (useProvider === 'tvdb' && useTvdb.isEnabled && tvdbToken) {
                      enriched2 = await enrichFromTVDB(searchTitle, searchYear, tvdbToken);
                      if (!enriched2 && useTmdb.isEnabled && useTmdb.apiKey) enriched2 = await enrichFromTMDB(searchTitle, searchYear, useTmdb.apiKey, isTV);
                    } else if (useTmdb.isEnabled && useTmdb.apiKey) {
                      enriched2 = await enrichFromTMDB(searchTitle, searchYear, useTmdb.apiKey, isTV);
                    }
                    if (enriched2) {
                      if (isTV) {
                        const tvInfo = parseTVFilename(m.fileName || '');
                        base.tagline = `S${String(tvInfo.season).padStart(2,'0')}E${String(tvInfo.episode).padStart(2,'0')} · Local TV Episode`;
                      }
                      Object.assign(base, { ...enriched2, isLocal: true, localFilePath: m.filePath, fileSize: m.fileSize, fileType: m.fileType, trailerUrl: m.streamUrl, addedAt: m.addedAt ?? 0, sourcePath: parentDir, id: base.id });
                    }
                    results.push(applyLocalOverrides(base));
                  }
                  return results;
                })();
                setCompanionScannedMovies(enriched);
                saveLibrary({ plexus_companion_movies: enriched });
                const sorted = [...enriched].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, 10);
                setRecentlyAdded(sorted);
              }
            }
          } else {
            setCompanionStatus('failed');
          }
        } catch (e) {
          setCompanionStatus('failed');
        }
      };
      pingStatus();
    }
  }, []);

  // Handle addition of simulated path directories
  const addLibraryPath = (pathStr: string, mode: LibraryPath['deviceType'], category?: string) => {
    const fresh: LibraryPath = {
      id: `path-${Date.now()}`,
      path: pathStr,
      deviceType: mode,
      category: category || 'Movies',
      fileCount: 0,
      scannedAt: 'Never'
    };
    const updated = [...libraryPaths, fresh];
    setLibraryPaths(updated);
    saveLibrary({ plexus_library_paths: updated });
  };

  // Handle removal of pathways — also prunes companion movies that belonged to the path
  const removeLibraryPath = (id: string) => {
    const removed = libraryPaths.find(p => p.id === id);
    const updated = libraryPaths.filter((p) => p.id !== id);
    setLibraryPaths(updated);
    saveLibrary({ plexus_library_paths: updated });

    if (removed) {
      const norm = (p?: string) =>
        (p || '').toUpperCase().replace(/[/\\]+/g, '/').replace(/\/$/, '');
      const pathNorm = norm(removed.path);
      setCompanionScannedMovies(prev => {
        const pruned = prev.filter(m =>
          !norm(m.localFilePath).startsWith(pathNorm) &&
          !norm(m.sourcePath).startsWith(pathNorm)
        );
        saveLibrary({ plexus_companion_movies: pruned });
        return pruned;
      });
    }
  };

  // --- INTERACTIVE MEDIA SCANNER MULTIPLEXER ---
  const triggerFolderScan = async (logLine: (line: string) => void) => {
    logLine("System core scanning initialized.");

    if (libraryPaths.length === 0) {
      logLine("ERROR: No library paths configured. Add paths in Settings first.");
      return;
    }

    logLine(`Target scanning pathways: [${libraryPaths.map(p => p.path).join(' | ')}]`);

    // POST paths to companion server — send full {path, category} objects so
    // categories are preserved on the server side (plain strings default to 'Movies').
    const pathObjects = libraryPaths.map(p => ({ path: p.path, category: p.category || 'Movies' }));
    try {
      const pathsRes = await fetch(`${companionHost}/api/paths`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: pathObjects })
      });
      if (!pathsRes.ok) throw new Error(`HTTP ${pathsRes.status}`);
      logLine(`Paths registered with companion server: ${pathObjects.map(p => `${p.path} [${p.category}]`).join(', ')}`);
    } catch (err: any) {
      logLine(`ERROR: Could not reach companion server at ${companionHost}/api/paths`);
      logLine(`Make sure 'node plexus-server.cjs' is running on the host machine.`);
      logLine(`Details: ${err.message}`);
      return;
    }

    // Fetch movie list
    let data: any;
    try {
      const moviesRes = await fetch(`${companionHost}/api/movies`);
      if (!moviesRes.ok) throw new Error(`HTTP ${moviesRes.status}`);
      data = await moviesRes.json();
    } catch (err: any) {
      logLine(`ERROR: Failed to fetch /api/movies: ${err.message}`);
      return;
    }

    // Print debug log from server
    if (data.debug && Array.isArray(data.debug)) {
      data.debug.forEach((line: string) => logLine(line));
    }

    logLine(`Enriching ${data.movies.length} files with metadata...`);
    const enriched = await enrichWithMetadata(data.movies);

    setCompanionScannedMovies(enriched);
    saveLibrary({ plexus_companion_movies: enriched });

    const sorted = [...enriched].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, 10);
    setRecentlyAdded(sorted);

    // Update fileCount and scannedAt on each path
    const updatedPaths = libraryPaths.map(lp => ({
      ...lp,
      fileCount: enriched.filter(m =>
        m.localFilePath?.startsWith(lp.path) || m.sourcePath?.startsWith(lp.path)
      ).length,
      scannedAt: new Date().toLocaleString()
    }));
    setLibraryPaths(updatedPaths);
    saveLibrary({ plexus_library_paths: updatedPaths });

    logLine(`SUMMARY: Mapped ${enriched.length} local streams`);
    logLine("Android TV Media Core - Scanning Engine: IDLE.");
  };

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Handle direct file import via drag and drop
  const handleFileImport = (file: File) => {
    const { title, year } = parseMovieFilename(file.name);
    
    const freshMovie: Movie = {
      id: `uploaded-${Date.now()}`,
      title: title || file.name,
      originalTitle: title || file.name,
      backdropPath: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80",
      posterPath: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=400&q=80",
      overview: `Successfully loaded local movie file "${file.name}". Click 'Play Video' to stream directly in the high-fidelity cinema player layout.`,
      rating: 8.5,
      releaseDate: year ? `${year}-01-01` : new Date().toISOString().split('T')[0],
      runtime: 120,
      genres: ["Imported File", file.name.split('.').pop()?.toUpperCase() || "MP4"],
      tagline: "Direct Browser Playback",
      isLocal: true,
      localFilePath: `/local-import/${file.name}`,
      fileSize: `${(file.size / (1024 * 1024 * 1024)).toFixed(2)} GB`,
      fileType: file.name.split('.').pop()?.toUpperCase() || 'MP4',
    };

    const freshFile: LocalFile = {
      id: `uploaded-${Date.now()}`,
      fileName: file.name,
      filePath: `/local-import/${file.name}`,
      fileSize: `${(file.size / (1024 * 1024 * 1024)).toFixed(2)} GB`,
      fileType: file.name.split('.').pop()?.toUpperCase() || 'MP4',
      addedAt: new Date().toLocaleDateString(),
      matchedMovieId: freshMovie.id
    };

    setCompanionScannedMovies(prev => [freshMovie, ...prev]);
    setCurrentHeroMovie(freshMovie);
    setLocalVideoFile(file); // Set browser reference so HTML Video can stream it
    setImportedFiles(prev => {
      const updated = [freshFile, ...prev];
      saveLibrary({ plexus_imported_files: updated });
      return updated;
    });

    // Launch details modal for direct playback
    setSelectedMovie(freshMovie);
  };

  const clearImported = () => {
    saveLibrary({ plexus_imported_files: [] });
    setImportedFiles([]);
    setLocalVideoFile(null);
  };

  // --- D-PAD / KEYBOARD REMOTE TRAVERSAL MATRIX ---

  // Continue Watching (and its TV-remote equivalent) only ever searched
  // companionScannedMovies — but getLibraryMovies() runs everything through
  // groupMoviesByShow() first, which gives grouped TV shows a synthetic id
  // that never appears in the raw scanned lists. That made "matched" come
  // back undefined for grouped shows: no click, and — since updateSession()
  // is the only place a Movie's poster art reaches a session — no poster.
  // This checks every source of Movie objects we track, ungrouped.
  const findLibraryMovieById = useCallback((id: string | undefined | null): Movie | undefined => {
    if (!id) return undefined;
    const flatTracker = Object.values(trackerMovies).flat();
    return (
      companionScannedMovies.find(m => m.id === id) ||
      localScannedMovies.find(m => m.id === id) ||
      flatTracker.find(m => m.id === id) ||
      recentlyAdded.find(m => m.id === id)
    );
  }, [companionScannedMovies, localScannedMovies, trackerMovies, recentlyAdded]);

  // Resolve the Movie behind a PlaybackSession. A session's movieId can go
  // stale relative to the *current* scan (e.g. metadata enrichment or a
  // rescan re-assigning ids after the session was written), so this checks
  // localFilePath across every source first — the one thing that doesn't
  // drift — before falling back to the plain id lookup above. This is what
  // Continue Watching (mouse click and TV-remote select) both need to call
  // instead of findLibraryMovieById directly, or a session whose movieId no
  // longer matches anything current silently resolves to nothing and the
  // click does nothing.
  //
  // Path comparisons go through normalizePath rather than a raw `===`: on
  // Windows the same file can come back with different slash direction or
  // casing between the scan that wrote the session and the scan currently
  // in state, so a strict string match silently fails even though it's the
  // same file — exactly what was making every Continue Watching card a
  // dead click regardless of platform.
  const findLibraryMovieForSession = useCallback((session: PlaybackSession | null | undefined): Movie | undefined => {
    if (!session) return undefined;
    if (session.localFilePath) {
      const normPath = normalizePath(session.localFilePath);
      const flatTracker = Object.values(trackerMovies).flat();
      const byPath =
        companionScannedMovies.find(m => m.localFilePath && normalizePath(m.localFilePath) === normPath) ||
        localScannedMovies.find(m => m.localFilePath && normalizePath(m.localFilePath) === normPath) ||
        flatTracker.find(m => m.localFilePath && normalizePath(m.localFilePath) === normPath) ||
        recentlyAdded.find(m => m.localFilePath && normalizePath(m.localFilePath) === normPath);
      if (byPath) return byPath;
    }
    return findLibraryMovieById(session.movieId);
  }, [companionScannedMovies, localScannedMovies, trackerMovies, recentlyAdded, findLibraryMovieById]);

  // One-time migration for sessions written before PlaybackSession had a
  // localFilePath field. Those legacy sessions have nothing for
  // findLibraryMovieForSession's path check to match against, so they still
  // fall through to the old movieId lookup — which is exactly the lookup
  // that was already failing (that's the whole reason localFilePath matching
  // was added). Without this, rebuilding the app changes nothing for
  // Continue Watching cards that were already sitting in the cache, since
  // they keep loading with no localFilePath and nothing here ever sets one.
  // Title is the one field every session has always recorded, so it's used
  // as the one-time recovery key to backfill localFilePath (and refresh
  // movieId to the current id) once the current scan is available. Runs
  // once per session that needs it; already-migrated / newly-created
  // sessions (which do have localFilePath) are left untouched.
  useEffect(() => {
    if (companionScannedMovies.length === 0) return;
    setPlaybackSessions(prev => {
      let changed = false;
      const migrated = prev.map(s => {
        if (s.localFilePath) return s;
        const match = companionScannedMovies.find(
          m => m.localFilePath && m.title.trim().toLowerCase() === s.title.trim().toLowerCase()
        );
        if (!match) return s;
        changed = true;
        return { ...s, localFilePath: match.localFilePath, movieId: match.id };
      });
      if (!changed) return prev;
      saveLibrary({ plexus_playback_sessions: migrated });
      return migrated;
    });
  }, [companionScannedMovies]);

  const getLibraryMovies = useCallback(() => {
    if (!selectedPathId) return [];
    const activePathObj = libraryPaths.find(p => p.id === selectedPathId);
    if (!activePathObj) return [];
    
    // companionScannedMovies first: it's refreshed from the server on every
    // boot, while localScannedMovies is a persisted cache that never gets
    // refreshed and can hold a stale id for a file whose id scheme has since
    // changed server-side. Putting it first here (as findLibraryMovieById
    // already does) means the dedup below keeps the fresh id, so a movie
    // opened from this shelf carries the same id its PlaybackSession was
    // saved under.
    const combined = [...companionScannedMovies, ...localScannedMovies].filter(
      (m, idx, self) => self.findIndex(t => (t.localFilePath || t.id) === (m.localFilePath || m.id)) === idx
    );

    const normalize = (p?: string) => (p || '').toUpperCase().replace(/[\\\/]+/g, '/').replace(/\/+$/, '');
    const pathNorm = normalize(activePathObj.path);
    return groupMoviesByShow(combined.filter(m => {
      // Strict path-only matching — no category name fallback (caused cross-contamination)
      const filePathNorm = normalize(m.localFilePath);
      const sourcePathNorm = normalize(m.sourcePath);
      if (filePathNorm && filePathNorm.startsWith(pathNorm)) return true;
      if (sourcePathNorm && sourcePathNorm.startsWith(pathNorm)) return true;
      return false;
    }));
  }, [selectedPathId, libraryPaths, localScannedMovies, companionScannedMovies]);

  const handleDpadUp = useCallback(() => {
    setFocusRow((prev) => {
      if (selectedTrackerCategory || selectedPathId) {
        const next = prev - 1;
        return next >= 1 ? next : 1;
      }
      const next = prev - 1;
      return next >= 0 ? next : 0;
    });
    setFocusCol(0);
  }, [selectedPathId, selectedTrackerCategory]);

  const handleDpadDown = useCallback(() => {
    // Dedicated tracker category grid
    if (selectedTrackerCategory) {
      const catMovies = trackerMovies[selectedTrackerCategory] || [];
      const maxRows = Math.ceil(catMovies.length / 5);
      setFocusRow(prev => {
        const next = prev + 1;
        return next <= maxRows ? next : maxRows;
      });
      setFocusCol(0);
      return;
    }

    if (selectedPathId) {
      setFocusRow((prev) => {
        const moviesList = getLibraryMovies();
        const maxRows = Math.ceil(moviesList.length / 5);
        const next = prev + 1;
        const limit = maxRows > 0 ? maxRows : 1;
        return next <= limit ? next : limit;
      });
      setFocusCol(0);
      return;
    }

    // Read all dynamic values OUTSIDE the state updater so they're never stale
    const hasContinue = playbackSessions.length > 0;
    const norm = (p?: string) => (p || '').toUpperCase().replace(/[\\\/]+/g, '/').replace(/\/+$/, '');
    const visibleLibPathCount = libraryPaths.filter(lp => {
      const pathNorm = norm(lp.path);
      return pathNorm.length > 0 && groupMoviesByShow(companionScannedMovies.filter(m =>
        norm(m.localFilePath).startsWith(pathNorm) ||
        norm(m.sourcePath).startsWith(pathNorm)
      )).length > 0;
    }).length;
    const visibleTrackerCount = trackerCategories.filter(cat =>
      (trackerMovies[cat.key] || []).length > 0
    ).length;
    const recentlyAddedRow = hasContinue ? 3 : 2;
    const hasRecentlyAdded = recentlyAdded.length > 0;
    const firstLibRow = hasRecentlyAdded ? recentlyAddedRow + 1 : recentlyAddedRow;
    const lastLibRow = visibleLibPathCount > 0
      ? firstLibRow + visibleLibPathCount - 1
      : hasRecentlyAdded
        ? recentlyAddedRow
        : hasContinue ? 2 : 1;
    const maxRow = lastLibRow + visibleTrackerCount;

    setFocusRow((prev) => {
      const next = prev + 1;
      return next <= maxRow ? next : maxRow;
    });
    setFocusCol(0);
  }, [selectedTrackerCategory, selectedPathId, getLibraryMovies, companionScannedMovies, playbackSessions.length, libraryPaths, recentlyAdded.length, trackerCategories, trackerMovies, groupMoviesByShow]);

  const handleDpadLeft = useCallback(() => {
    setFocusCol((prev) => {
      const next = prev - 1;
      return next >= 0 ? next : 0;
    });
  }, []);

  const handleDpadRight = useCallback(() => {
    // Compute all row/col limits OUTSIDE the state updater to avoid stale closures
    const hasContinue = playbackSessions.length > 0;
    const recentlyAddedRowIndex = hasContinue ? 3 : 2;
    const hasRecentlyAdded = recentlyAdded.length > 0;
    const firstLibRow = hasRecentlyAdded ? recentlyAddedRowIndex + 1 : recentlyAddedRowIndex;
    const norm = (p?: string) => (p || '').toUpperCase().replace(/[\\\/]+/g, '/').replace(/\/+$/, '');
    const visibleLibPaths = libraryPaths.filter(lp => {
      const pathNorm = norm(lp.path);
      return pathNorm.length > 0 && groupMoviesByShow(companionScannedMovies.filter(m =>
        norm(m.localFilePath).startsWith(pathNorm) ||
        norm(m.sourcePath).startsWith(pathNorm)
      )).length > 0;
    });
    const lastLibRow = visibleLibPaths.length > 0 ? firstLibRow + visibleLibPaths.length - 1 : firstLibRow - 1;
    const visibleTrackerCats = trackerCategories.filter(cat => (trackerMovies[cat.key] || []).length > 0);
    const firstTrackerRow = lastLibRow + 1;
    const trackerRowOffset = focusRow - firstTrackerRow;

    setFocusCol((prev) => {
      const next = prev + 1;

      // Dedicated tracker category grid (CAT_COLS cols)
      if (selectedTrackerCategory) {
        const catMovies = trackerMovies[selectedTrackerCategory] || [];
        const rowStartIndex = (focusRow - 1) * CAT_COLS;
        const remainingInRow = catMovies.length - rowStartIndex;
        const colsInThisRow = Math.min(CAT_COLS, remainingInRow);
        const limit = colsInThisRow > 0 ? colsInThisRow - 1 : 0;
        return next <= limit ? next : limit;
      }

      if (selectedPathId) {
        const moviesList = getLibraryMovies();
        const rowStartIndex = (focusRow - 1) * CAT_COLS;
        const remainingInRow = moviesList.length - rowStartIndex;
        const colsInThisRow = Math.min(CAT_COLS, remainingInRow);
        const limit = colsInThisRow > 0 ? colsInThisRow - 1 : 0;
        return next <= limit ? next : limit;
      }

      if (focusRow === 0) {
        // Only allow col 1 (torrent widget) when TrackerFlix is connected and has active torrents
        const widgetAvailable = trackerFlixStatus === 'connected';
        return next <= (widgetAvailable ? 1 : 0) ? next : (widgetAvailable ? 1 : 0);
      }
      if (focusRow === 1) return next < 2 ? next : 1;
      if (focusRow === 2 && hasContinue) {
        return next < playbackSessions.length ? next : playbackSessions.length - 1;
      }
      if (focusRow === recentlyAddedRowIndex && hasRecentlyAdded) {
        const limit = recentlyAdded.length - 1;
        return next <= limit ? next : limit;
      }
      if (focusRow >= firstLibRow && trackerRowOffset < 0) {
        const libPath = visibleLibPaths[focusRow - firstLibRow];
        if (libPath) {
          const rowMovies = companionScannedMovies.filter(m =>
            norm(m.localFilePath).startsWith(norm(libPath.path)) ||
            norm(m.sourcePath).startsWith(norm(libPath.path))
          );
          const limit = rowMovies.length > 0 ? rowMovies.length - 1 : 0;
          return next <= limit ? next : limit;
        }
      }
      if (trackerRowOffset >= 0 && trackerRowOffset < visibleTrackerCats.length) {
        const cat = visibleTrackerCats[trackerRowOffset];
        const catMovies = trackerMovies[cat.key] || [];
        const limit = catMovies.length > 0 ? catMovies.length - 1 : 0;
        return next <= limit ? next : limit;
      }
      return next;
    });
  }, [selectedTrackerCategory, selectedPathId, getLibraryMovies, focusRow, playbackSessions.length, companionScannedMovies, libraryPaths, recentlyAdded.length, trackerCategories, trackerMovies, trackerFlixStatus]);

  const handleDpadSelect = useCallback(() => {
    // Dedicated tracker category grid view (5 cols)
    if (selectedTrackerCategory) {
      const catMovies = trackerMovies[selectedTrackerCategory] || [];
      const selectedIndex = (focusRow - 1) * CAT_COLS + focusCol;
      const selMovie = catMovies[selectedIndex];
      if (selMovie) setSelectedMovie(selMovie);
      return;
    }

    if (selectedPathId) {
      const moviesList = getLibraryMovies();
      const selectedIndex = (focusRow - 1) * CAT_COLS + focusCol;
      const selMovie = moviesList[selectedIndex];
      if (selMovie) setSelectedMovie(selMovie);
      return;
    }

    const hasContinue = playbackSessions.length > 0;
    const recentlyAddedRowIndex = hasContinue ? 3 : 2;
    const hasRecentlyAdded = recentlyAdded.length > 0;
    const firstLibRow = hasRecentlyAdded ? recentlyAddedRowIndex + 1 : recentlyAddedRowIndex;
    const norm = (p?: string) => (p || '').toUpperCase().replace(/[\\\/]+/g, '/').replace(/\/+$/, '');
    const visibleLibPaths = libraryPaths.filter(lp => {
      const pathNorm = norm(lp.path);
      return pathNorm.length > 0 && groupMoviesByShow(companionScannedMovies.filter(m =>
        norm(m.localFilePath).startsWith(pathNorm) ||
        norm(m.sourcePath).startsWith(pathNorm)
      )).length > 0;
    });
    const lastLibRow = visibleLibPaths.length > 0 ? firstLibRow + visibleLibPaths.length - 1 : firstLibRow - 1;
    const visibleTrackerCats = trackerCategories.filter(cat => (trackerMovies[cat.key] || []).length > 0);
    const firstTrackerRow = lastLibRow + 1;
    const trackerRowOffset = focusRow - firstTrackerRow;

    if (focusRow === 0) {
      if (focusCol === 0) { setActiveTab('home'); setSelectedPathId(null); }
    } else if (focusRow === 1) {
      if (focusCol === 0) {
        if (currentHeroMovie?.isLocal && (currentHeroMovie?.localFilePath || currentHeroMovie?.sourcePath)) {
          const session = findSessionForMovie(currentHeroMovie);
          if (targetPlatform === 'android-tv') {
            playNative(currentHeroMovie, session?.currentTime ?? 0);
          } else {
            playWithMPV(currentHeroMovie, session?.currentTime ?? 0);
          }
        } else {
          setPlayingMovie(currentHeroMovie);
        }
      }
      if (focusCol === 1) setSelectedMovie(currentHeroMovie);
    } else if (focusRow === 2 && hasContinue) {
      const sessionObj = playbackSessions[focusCol];
      const matchedMov = findLibraryMovieForSession(sessionObj);
      if (matchedMov) {
        if (matchedMov.isLocal && (matchedMov.localFilePath || matchedMov.sourcePath)) {
          if (targetPlatform === 'android-tv') {
            playNative(matchedMov, sessionObj.currentTime);
          } else {
            playWithMPV(matchedMov, sessionObj.currentTime);
          }
        } else {
          setPlayingMovie(matchedMov);
        }
      } else {
        console.warn('[ContinueWatching enter] no matchedMov — bailing');
      }
    } else if (focusRow === recentlyAddedRowIndex && hasRecentlyAdded) {
      const mov = recentlyAdded[focusCol];
      if (mov) setSelectedMovie(mov);
    } else if (focusRow >= firstLibRow && trackerRowOffset < 0) {
      const libPath = visibleLibPaths[focusRow - firstLibRow];
      if (libPath) {
        const rowMovies = groupMoviesByShow(companionScannedMovies.filter(m =>
          norm(m.localFilePath).startsWith(norm(libPath.path)) ||
          norm(m.sourcePath).startsWith(norm(libPath.path))
        ));
        if (rowMovies[focusCol]) setSelectedMovie(rowMovies[focusCol]);
      }
    } else if (trackerRowOffset >= 0 && trackerRowOffset < visibleTrackerCats.length) {
      const cat = visibleTrackerCats[trackerRowOffset];
      const catMovies = trackerMovies[cat.key] || [];
      if (catMovies[focusCol]) setSelectedMovie(catMovies[focusCol]);
    }
  }, [
    selectedTrackerCategory, selectedPathId, getLibraryMovies, focusRow, focusCol,
    playbackSessions, currentHeroMovie, companionScannedMovies,
    libraryPaths, recentlyAdded.length, trackerCategories, trackerMovies, groupMoviesByShow,
  ]);

  const handleDpadBack = useCallback(() => {
    if (playingMovie) {
      setPlayingMovie(null);
    } else if (selectedMovie) {
      setSelectedMovie(null);
    } else if (selectedTrackerCategory) {
      setSelectedTrackerCategory(null);
      setFocusRow(1);
      setFocusCol(0);
    } else if (activeTab === 'settings') {
      setActiveTab('home');
    }
  }, [playingMovie, selectedMovie, selectedTrackerCategory, activeTab]);

  // --- UNIFIED CONTROLLER NAVIGATION LAYER ---
  // When the torrent widget owns focus, route D-pad actions to it.
  // The widget returns true if it consumed the action, false to let App handle normally
  // (e.g. pressing Left at the leftmost action button → fall through to navigate out of widget).
  const dispatchToTorrentWidget = (action: 'up' | 'down' | 'left' | 'right' | 'select'): boolean => {
    if (!(focusRow === 0 && focusCol === 1)) return false;
    const nav = (window as any).__torrentWidgetNav;
    if (!nav) return false;
    const consumed = nav[action]?.();
    return consumed === true;
  };

  const handleDpadUpUnified = useCallback(() => {
    if (focusRow === 0 && focusCol === 1) {
      const consumed = dispatchToTorrentWidget('up');
      if (!consumed) setFocusCol(0);
      return;
    }
    if (showStreamingView) {
      if (streamingFocusArea === 'grid') {
        if (streamingGridRow === 0) {
          // Move up from grid row 0 → filters row
          setStreamingFocusArea('filters');
        } else {
          setStreamingGridRow(prev => prev - 1);
        }
      }
      // Already in filters — nowhere to go up
      return;
    }
    if (isSidebarFocused) {
      setSidebarFocusIdx(prev => Math.max(0, prev - 1));
    } else {
      handleDpadUp();
    }
  }, [isSidebarFocused, handleDpadUp, focusRow, focusCol, showStreamingView, streamingFocusArea, streamingGridRow]);

  const handleDpadDownUnified = useCallback(() => {
    if (focusRow === 0 && focusCol === 1) {
      const consumed = dispatchToTorrentWidget('down');
      if (!consumed) { setFocusCol(0); setFocusRow(1); }
      return;
    }
    if (showStreamingView) {
      if (streamingFocusArea === 'filters') {
        setStreamingFocusArea('grid');
        setStreamingGridRow(0);
      } else {
        const maxRow = Math.max(0, Math.ceil(streamingMovies.length / STREAMING_COLS) - 1);
        if (streamingGridRow < maxRow) {
          const newRow = streamingGridRow + 1;
          const itemsInRow = streamingMovies.slice(newRow * STREAMING_COLS, (newRow + 1) * STREAMING_COLS).length;
          setStreamingGridRow(newRow);
          setStreamingGridCol(prev => Math.min(prev, itemsInRow - 1));
        }
      }
      return;
    }
    if (isSidebarFocused) {
      const showStreaming = streamingProviders.length > 0 || trackerFlixStatus === 'connected';
      const sidebarItemsCount = 2 + libraryPaths.length + trackerCategories.length + (showStreaming ? 1 : 0);
      setSidebarFocusIdx(prev => Math.min(sidebarItemsCount - 1, prev + 1));
      return;
    }
    if (selectedTrackerCategory) {
      const catMovies = trackerMovies[selectedTrackerCategory] || [];
      const maxRows = Math.ceil(catMovies.length / 5);
      setFocusRow(prev => { const next = prev + 1; return next <= maxRows ? next : maxRows; });
      setFocusCol(0);
      return;
    }
    if (selectedPathId) {
      const moviesList = getLibraryMovies();
      const maxRows = Math.ceil(moviesList.length / 5);
      setFocusRow(prev => { const next = prev + 1; const limit = maxRows > 0 ? maxRows : 1; return next <= limit ? next : limit; });
      setFocusCol(0);
      return;
    }
    const hasContinue = playbackSessions.length > 0;
    const norm = (p?: string) => (p || '').toUpperCase().replace(/[\\\/]+/g, '/').replace(/\/+$/, '');
    const visibleLibPathCount = libraryPaths.filter(lp => {
      const pathNorm = norm(lp.path);
      return pathNorm.length > 0 && groupMoviesByShow(companionScannedMovies.filter(m =>
        norm(m.localFilePath).startsWith(pathNorm) || norm(m.sourcePath).startsWith(pathNorm)
      )).length > 0;
    }).length;
    const visibleTrackerCount = trackerCategories.filter(cat => (trackerMovies[cat.key] || []).length > 0).length;
    const recentlyAddedRow = hasContinue ? 3 : 2;
    const hasRecentlyAdded = recentlyAdded.length > 0;
    const firstLibRow = hasRecentlyAdded ? recentlyAddedRow + 1 : recentlyAddedRow;
    const lastLibRow = visibleLibPathCount > 0 ? firstLibRow + visibleLibPathCount - 1 : hasRecentlyAdded ? recentlyAddedRow : hasContinue ? 2 : 1;
    const maxRow = lastLibRow + visibleTrackerCount;
    setFocusRow(prev => { const next = prev + 1; return next <= maxRow ? next : maxRow; });
    setFocusCol(0);
  }, [
    isSidebarFocused, selectedPathId, selectedTrackerCategory, getLibraryMovies,
    libraryPaths, trackerCategories, trackerMovies, streamingProviders, trackerFlixStatus,
    companionScannedMovies, playbackSessions.length, recentlyAdded.length,
    focusRow, focusCol, showStreamingView, streamingFocusArea, streamingGridRow,
    streamingMovies, STREAMING_COLS,
  ]);
  const handleDpadLeftUnified = useCallback(() => {
    if (focusRow === 0 && focusCol === 1) {
      const consumed = dispatchToTorrentWidget('left');
      if (!consumed) setFocusCol(0);
      return;
    }
    if (showStreamingView) {
      if (streamingFocusArea === 'filters') {
        const filterCount = 1 + streamingProviders.length; // All + providers
        setStreamingFilterIdx(prev => Math.max(0, prev - 1));
      } else {
        if (streamingGridCol === 0) {
          // Left edge of grid — go to sidebar
          setIsSidebarFocused(true);
          setIsSidebarExpanded(true);
          setSidebarFocusIdx(2 + libraryPaths.length); // streaming item index
        } else {
          setStreamingGridCol(prev => prev - 1);
        }
      }
      return;
    }
    if (isSidebarFocused) {
      // already in sidebar
    } else {
      if (focusCol === 0) {
        setIsSidebarFocused(true);
        setIsSidebarExpanded(true);
        if (activeTab === 'settings') {
          setSidebarFocusIdx(1 + libraryPaths.length);
        } else if (selectedTrackerCategory) {
          const trackerIdx = trackerCategories.findIndex(c => c.key === selectedTrackerCategory);
          setSidebarFocusIdx(2 + libraryPaths.length + (trackerIdx !== -1 ? trackerIdx : 0));
        } else if (selectedPathId) {
          const activeIdx = libraryPaths.findIndex(p => p.id === selectedPathId);
          setSidebarFocusIdx(activeIdx !== -1 ? activeIdx + 1 : 0);
        } else {
          setSidebarFocusIdx(0);
        }
      } else {
        handleDpadLeft();
      }
    }
  }, [isSidebarFocused, focusCol, focusRow, handleDpadLeft, activeTab, selectedPathId, selectedTrackerCategory, libraryPaths, trackerCategories, showStreamingView, streamingFocusArea, streamingGridCol, streamingProviders]);

  const handleDpadRightUnified = useCallback(() => {
    if (focusRow === 0 && focusCol === 1) {
      dispatchToTorrentWidget('right');
      return;
    }
    if (showStreamingView) {
      if (streamingFocusArea === 'filters') {
        const filterCount = 1 + streamingProviders.length;
        setStreamingFilterIdx(prev => Math.min(prev + 1, filterCount - 1));
      } else {
        const rowStart = streamingGridRow * STREAMING_COLS;
        const itemsInRow = streamingMovies.slice(rowStart, rowStart + STREAMING_COLS).length;
        setStreamingGridCol(prev => Math.min(prev + 1, itemsInRow - 1));
      }
      return;
    }
    if (isSidebarFocused) {
      setIsSidebarFocused(false);
      setIsSidebarExpanded(false);
      if (activeTab === 'settings') {
        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
      }
    } else {
      handleDpadRight();
    }
  }, [isSidebarFocused, handleDpadRight, focusRow, focusCol, activeTab, showStreamingView, streamingFocusArea, streamingFilterIdx, streamingGridRow, streamingGridCol, streamingMovies, streamingProviders, STREAMING_COLS]);

  const handleDpadSelectUnified = useCallback(() => {
    if (focusRow === 0 && focusCol === 1) {
      dispatchToTorrentWidget('select');
      return;
    }
    if (showStreamingView) {
      if (streamingFocusArea === 'filters') {
        // Select a filter pill
        if (streamingFilterIdx === 0) {
          setStreamingProviderId(null);
          fetchStreamingCatalog(null, 1);
        } else {
          const provider = streamingProviders[streamingFilterIdx - 1];
          if (provider) { setStreamingProviderId(provider.id); fetchStreamingCatalog(provider.id, 1); }
        }
        setStreamingFocusArea('grid');
        setStreamingGridRow(0);
        setStreamingGridCol(0);
      } else {
        // Select a movie card
        const idx = streamingGridRow * STREAMING_COLS + streamingGridCol;
        const movie = streamingMovies[idx];
        if (movie) openStreamingMovie(movie);
      }
      return;
    }
    if (isSidebarFocused) {
      // Order MUST match Sidebar.tsx sidebarItems: home, libraryPaths, settings, trackerCategories
      const sidebarItems = [
        { id: 'all-browse', label: 'All Browse', isSettings: false, isTracker: false, isStreaming: false },
        ...libraryPaths.map(p => ({ id: p.id, label: p.category || 'Movies', isSettings: false, isTracker: false, isStreaming: false })),
        { id: 'settings', label: 'Settings', isSettings: true, isTracker: false, isStreaming: false },
        ...((streamingProviders.length > 0 || trackerFlixStatus === 'connected') ? [{ id: 'streaming', label: 'Streaming', isSettings: false, isTracker: false, isStreaming: true }] : []),
        ...trackerCategories.map(c => ({ id: `tracker-${c.key}`, label: c.label, isSettings: false, isTracker: true, isStreaming: false, trackerKey: c.key })),
      ];
      const activatedItem = sidebarItems[sidebarFocusIdx] as any;
      if (activatedItem) {
        if (activatedItem.isSettings) {
          setActiveTab('settings');
          setSelectedPathId(null);
          setSelectedTrackerCategory(null);
        } else if (activatedItem.isStreaming) {
          setShowStreamingView(true);
          setSelectedPathId(null);
          setSelectedTrackerCategory(null);
          setStreamingFocusArea('grid');
          setStreamingGridRow(0);
          setStreamingGridCol(0);
          setStreamingFilterIdx(0);
        } else if (activatedItem.id === 'all-browse') {
          setActiveTab('home');
          setSelectedPathId(null);
          setSelectedTrackerCategory(null);
        } else if (activatedItem.isTracker) {
          setActiveTab('home');
          setSelectedPathId(null);
          setSelectedTrackerCategory(activatedItem.trackerKey);
        } else {
          setActiveTab('home');
          setSelectedPathId(activatedItem.id);
          setSelectedTrackerCategory(null);
        }
        setIsSidebarFocused(false);
        setIsSidebarExpanded(false);
        setFocusRow(1);
        setFocusCol(0);
      }
    } else {
      handleDpadSelect();
    }
  }, [isSidebarFocused, sidebarFocusIdx, libraryPaths, trackerCategories, selectedTrackerCategory, handleDpadSelect, focusRow, focusCol, streamingProviders, trackerFlixStatus, showStreamingView, streamingFocusArea, streamingGridRow, streamingGridCol, streamingFilterIdx, streamingMovies, STREAMING_COLS]);

  const handleDpadBackUnified = useCallback(() => {
    if (isSidebarFocused) {
      setIsSidebarFocused(false);
      setIsSidebarExpanded(false);
    } else {
      handleDpadBack();
    }
  }, [isSidebarFocused, handleDpadBack]);

  // Handle hardware keyboard interactions and left navigation drawer
  useEffect(() => {
    if (!isTvMode) return;
    // Record when the app mounted. Any Enter keypress within 300 ms is almost
    // certainly the stray event that closed the ConnectionGate (link approval
    // or manual connect button) — ignore it so it doesn't fire into the grid.
    const mountedAt = Date.now();

    const handleHardwareKeyPress = (e: KeyboardEvent) => {
      if (playingMovie) return; // Player has standard custom speed modifiers
      // Swallow stray Enter that leaks from the ConnectionGate on first mount
      if (e.key === 'Enter' && Date.now() - mountedAt < 300) return;
      // Never intercept keys when the user is typing in an input, textarea, or contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      if (isEditable) return;
      // While a modal is open, only allow Escape/Backspace to close it — block all grid nav
      if (selectedMovie || qualityPickerMovie) {
        if (e.key === 'Escape' || e.key === 'Backspace') {
          e.preventDefault();
          handleDpadBackUnified();
        }
        return;
      }
      // When torrent widget is focused (row 0, col 1) route to it via unified handlers
      if (focusRow === 0 && focusCol === 1) {
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault();
            handleDpadUpUnified();
            break;
          case 'ArrowDown':
            e.preventDefault();
            handleDpadDownUnified();
            break;
          case 'ArrowLeft':
            e.preventDefault();
            handleDpadLeftUnified();
            break;
          case 'ArrowRight':
            e.preventDefault();
            handleDpadRightUnified();
            break;
          case 'Enter':
            e.preventDefault();
            handleDpadSelectUnified();
            break;
          case 'Escape':
          case 'Backspace':
            e.preventDefault();
            // Exit widget back to col 0
            setFocusCol(0);
            break;
        }
        return;
      }

      // Settings panel open: Up/Down scroll the page, Left returns to sidebar, block grid nav
      if (activeTab === 'settings' && !isSidebarFocused) {
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault();
            window.scrollBy({ top: -200, behavior: 'smooth' });
            break;
          case 'ArrowDown':
            e.preventDefault();
            window.scrollBy({ top: 200, behavior: 'smooth' });
            break;
          case 'ArrowLeft':
            e.preventDefault();
            handleDpadLeftUnified();
            break;
          case 'Escape':
          case 'Backspace':
            e.preventDefault();
            handleDpadBackUnified();
            break;
          default:
            break;
        }
        return;
      }

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          handleDpadUpUnified();
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleDpadDownUnified();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleDpadLeftUnified();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleDpadRightUnified();
          break;
        case 'Enter':
          e.preventDefault();
          handleDpadSelectUnified();
          break;
        case 'Escape':
        case 'Backspace':
          e.preventDefault();
          handleDpadBackUnified();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleHardwareKeyPress);
    return () => window.removeEventListener('keydown', handleHardwareKeyPress);
  }, [
    isTvMode,
    playingMovie,
    selectedMovie,
    qualityPickerMovie,
    focusRow,
    focusCol,
    handleDpadUpUnified, 
    handleDpadDownUnified, 
    handleDpadLeftUnified, 
    handleDpadRightUnified, 
    handleDpadSelectUnified, 
    handleDpadBackUnified,
    activeTab,
    isSidebarFocused,
  ]);

  // Dynamically align active hero banner preview as focus cursor shifts indices.
  // Covers all rows so onMouseEnter from offscreen cards never overwrites the
  // focused card's backdrop. Also ensures local files without backdropPath fall
  // back to their posterPath so the hero is never blank.
  useEffect(() => {
    if (!isTvMode) return;
    const hasContinue = playbackSessions.length > 0;
    const recentlyAddedRowIndex = hasContinue ? 3 : 2;
    const firstCategoryRowIndex = hasContinue ? 4 : 3;

    const setHero = (mov: Movie | null | undefined) => {
      if (!mov) return;
      // Ensure local files always have something to show in the hero
      const heroMov = (!mov.backdropPath && mov.posterPath)
        ? { ...mov, backdropPath: mov.posterPath }
        : mov;
      setCurrentHeroMovie(heroMov);
    };

    if (focusRow === recentlyAddedRowIndex && recentlyAdded[focusCol]) {
      setHero(recentlyAdded[focusCol]);
    } else if (focusRow >= firstCategoryRowIndex && !selectedPathId) {
      // Home screen category shelf rows (Movies, TV Shows, Cartoons)
      const pathIndex = focusRow - firstCategoryRowIndex;
      const libPath = libraryPaths[pathIndex];
      if (libPath) {
        const norm = (p?: string) => (p || '').toUpperCase().replace(/[\\/]+/g, '/').replace(/\/+$/, '');
        const pathNorm = norm(libPath.path);
        const rowMovies = companionScannedMovies.filter(m =>
          (norm(m.localFilePath).startsWith(pathNorm) && pathNorm.length > 0) ||
          (norm(m.sourcePath).startsWith(pathNorm) && pathNorm.length > 0)
        );
        setHero(rowMovies[focusCol]);
      }
    } else if (focusRow >= 1 && selectedPathId) {
      // Inside a category grid view — use getLibraryMovies() so order matches the rendered grid exactly
      const gridMovies = getLibraryMovies();
      const flatIndex = (focusRow - 1) * CAT_COLS + focusCol;
      setHero(gridMovies[flatIndex]);
    }
  }, [isTvMode, focusRow, focusCol, companionScannedMovies, playbackSessions.length,
      recentlyAdded, libraryPaths, selectedPathId, getLibraryMovies]);

  // Smooth eased vertical scroll — replaces unpredictable scrollIntoView
  const smoothScrollTo = useCallback((targetY: number, duration = 380) => {
    const startY = window.scrollY;
    const distance = targetY - startY;
    if (Math.abs(distance) < 2) return;
    const startTime = performance.now();
    const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      window.scrollTo(0, startY + distance * ease(progress));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  // Auto-scroll for D-pad navigation.
  // Vertical: custom eased scroll keeps focused row in view without jank.
  // Horizontal: centers focused card in its shelf scroller.
  // 350ms delay lets Framer Motion spring animations settle before measuring.
  useEffect(() => {
    if (!isTvMode) return;

    const hasContinue = playbackSessions.length > 0;
    const recentlyAddedRowIndex = hasContinue ? 3 : 2;
    const firstCategoryRowIndex = hasContinue ? 4 : 3;

    const timer = setTimeout(() => {
      // ── 1. Vertical ───────────────────────────────────────────────────────
      // When inside a grid view (library path or tracker category), scroll the
      // focused card directly into view rather than looking up a row section element.
      if (selectedPathId || selectedTrackerCategory) {
        const focusedCard = document.querySelector<HTMLElement>('[data-dpad-focused="true"]');
        if (focusedCard) {
          const rect = focusedCard.getBoundingClientRect();
          const viewportH = window.innerHeight;
          const elTop = rect.top + window.scrollY;
          const margin = 120;
          if (rect.top < margin) {
            smoothScrollTo(elTop - margin);
          } else if (rect.bottom > viewportH - margin) {
            smoothScrollTo(elTop - viewportH + rect.height + margin);
          }
        }
      } else {
        let rowEl: HTMLElement | null = null;
        if (focusRow === 2 && hasContinue) {
          rowEl = document.getElementById('row-continue');
        } else if (focusRow === recentlyAddedRowIndex && recentlyAdded.length > 0) {
          rowEl = document.getElementById('row-recently-added');
        } else if (focusRow >= firstCategoryRowIndex) {
          rowEl = document.getElementById(`row-${focusRow}`);
        }

        if (rowEl) {
          const rect = rowEl.getBoundingClientRect();
          const viewportH = window.innerHeight;
          const elTop = rect.top + window.scrollY;
          const elBottom = elTop + rect.height;
          const margin = 80;

          if (rect.top < margin) {
            smoothScrollTo(elTop - margin);
          } else if (rect.bottom > viewportH - margin) {
            smoothScrollTo(elBottom - viewportH + margin);
          }
          // Already fully visible → no scroll
        } else if (focusRow <= 1) {
          // Hero or nav header — always scroll fully back to the top
          smoothScrollTo(0);
        }
      }

      // ── 2. Horizontal ─────────────────────────────────────────────────────
      const focusedCard = document.querySelector<HTMLElement>('[data-dpad-focused="true"]');
      if (!focusedCard) return;

      let scroller: HTMLElement | null = focusedCard.parentElement;
      while (scroller && scroller !== document.body) {
        const overflow = getComputedStyle(scroller).overflowX;
        if (overflow === 'auto' || overflow === 'scroll') break;
        scroller = scroller.parentElement;
      }
      if (!scroller || scroller === document.body) return;

      const scrollerRect = scroller.getBoundingClientRect();
      const cardRect = focusedCard.getBoundingClientRect();
      const cardLeftInScroller = cardRect.left - scrollerRect.left + scroller.scrollLeft;
      const targetLeft = cardLeftInScroller - (scrollerRect.width / 2) + (cardRect.width / 2);
      scroller.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
    }, 350);

    return () => clearTimeout(timer);
  }, [isTvMode, focusRow, focusCol, playbackSessions.length, recentlyAdded.length, libraryPaths.length, selectedPathId, selectedTrackerCategory, smoothScrollTo]);

  const localLibraryMovies = companionScannedMovies.filter(m => m.isLocal || m.localFilePath);

  if (isGateClosed) {
    return (
      <ConnectionGate
        targetPlatform={targetPlatform}
        onConnected={(addr) => {
  setConnectedServerAddress(addr);
  const fullHost = normalizeHost(addr);
  setCompanionHost(fullHost);
  localStorage.setItem('plexus_companion_host', fullHost);
  setIsGateClosed(false);
  localStorage.setItem('strom_gate_open_session', 'true');
        }}
      />
    );
  }

  return (
    <ActivePreviewProvider>
      <div id="plexus-application-wrapper" className="min-h-screen bg-[#050505] text-slate-100 flex flex-col relative select-none overflow-x-hidden pl-[72px]">
      
      {/* Sidebar collapsible left drawer */}
      <Sidebar
        libraryPaths={libraryPaths}
        isExpanded={isSidebarExpanded}
        isFocused={isSidebarFocused}
        focusedIndex={sidebarFocusIdx}
        selectedPathId={selectedPathId}
        trackerCategories={trackerCategories}
        selectedTrackerCategory={selectedTrackerCategory}
        showStreamingItem={streamingProviders.length > 0 || trackerFlixStatus === 'connected'}
        isStreamingSelected={showStreamingView}
        onSelectStreaming={() => {
          setShowStreamingView(true);
          setStreamingFocusArea('grid');
          setStreamingGridRow(0);
          setStreamingGridCol(0);
          setStreamingFilterIdx(0);
          setSelectedTrackerCategory(null);
          setSelectedPathId(null);
          setActiveTab('home');
          setFocusRow(1);
          setFocusCol(0);
          if (streamingMovies.length === 0) fetchStreamingCatalog(null, 1);
        }}
        onSelectTrackerCategory={(key) => {
          setSelectedTrackerCategory(key);
          setSelectedPathId(null);
          setShowStreamingView(false);
          setActiveTab('home');
          setFocusRow(1);
          setFocusCol(0);
        }}
        onSelectCategory={(pathId) => {
          setSelectedPathId(pathId);
          setSelectedTrackerCategory(null);
          setShowStreamingView(false);
          setActiveTab('home');
          setFocusRow(1);
          setFocusCol(0);
        }}
        onGoToSettings={() => {
          setActiveTab('settings');
          setSelectedPathId(null);
          setSelectedTrackerCategory(null);
          setFocusRow(0);
          setFocusCol(0);
        }}
        targetPlatform={targetPlatform}
      />
      
      {/* Immersive Background Atmosphere Blobs */}
      <div className="absolute inset-0 opacity-40 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 right-0 w-[800px] h-[600px] bg-gradient-to-bl from-orange-600/30 via-transparent to-transparent blur-[120px]"></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[500px] bg-gradient-to-tr from-blue-900/40 via-transparent to-transparent blur-[100px]"></div>
      </div>
      
      {/* BACKGROUND SPOTLIGHT LAYER: Renders high-fidelity full-screen immersive dynamic backdrop from active featured movie */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden w-full h-full">
        {(tmdbConfig.showBackdrop ?? true) && (
          <AnimatePresence mode="popLayout">
            <motion.div
              key={currentHeroMovie?.backdropPath || 'default-backdrop'}
              id="strom-dynamic-wall-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.75 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.0, ease: "easeInOut" }}
              className="absolute inset-0 h-full w-full bg-cover bg-center scale-100 saturate-[1.15]"
              style={{
                backgroundImage: `url(${currentHeroMovie?.backdropPath || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1600&q=80'})`,
              }}
            />
          </AnimatePresence>
        )}
        {/* Cinematic full-bleed gradients for ultimate screen legibility with no harsh dark blocks */}
        <div className="absolute inset-0 bg-black/25" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/40 to-black/20" />
      </div>

      {/* FLOATING HEADER MENU */}
      <header className="relative z-30 w-full bg-black/40 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 xl:px-12 h-20 flex items-center justify-between">
          
          {/* Logo & Platform Name */}
          <div id="site-logo-brand" className="flex items-center gap-3">
            <div className="flex flex-col leading-tight">
              <span className="text-white font-black text-xl tracking-widest uppercase">STRØM</span>
              <span className="text-zinc-500 font-mono text-[10px] tracking-widest uppercase">Power Your Cinema</span>
            </div>
          </div>


          {/* Right side of nav: platform badge + torrent widget if connected */}
          <div className="hidden md:flex items-center gap-3">

            {/* Torrent widget inline in nav */}
            {trackerFlixStatus === 'connected' && (
              <div className={isTvMode && focusRow === 0 && focusCol === 1 ? `rounded-xl ring-2 ${targetPlatform === 'tizen-tv' ? 'ring-cyan-400' : 'ring-orange-500'} ring-offset-2 ring-offset-[#050505]` : ''}>
                <TorrentWidget host={trackerFlixHost} forceOpen={isTvMode && focusRow === 0 && focusCol === 1} />
              </div>
            )}
          </div>

        </div>
      </header>

      {/* MAIN VIEW CONTROLLER GRID */}
      <main className="relative z-10 flex-1 w-full max-w-7xl mx-auto px-6 sm:px-8 xl:px-12 pb-24 pt-0">
        {activeTab === 'home' && showStreamingView ? (
          /* STREAMING CATALOG VIEW */
          <div className="space-y-6 mt-6">
            {/* Header */}
            <div className="flex flex-col gap-4 border-b border-white/5 pb-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold tracking-widest uppercase px-3 py-1 rounded-full bg-violet-500/10 text-violet-400">
                      Streaming
                    </span>
                  </div>
                  <h1 className="text-3xl font-black font-sans tracking-tight text-white">Now Streaming</h1>
                </div>
                <button
                  onClick={() => { setShowStreamingView(false); setFocusRow(1); setFocusCol(0); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border border-white/10 bg-zinc-900 text-zinc-300 hover:bg-white/5 cursor-pointer"
                >
                  ✕ Back to All
                </button>
              </div>

              {/* Provider filter pills */}
              {streamingProviders.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => { setStreamingProviderId(null); fetchStreamingCatalog(null, 1); }}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold font-mono uppercase tracking-wider transition-all cursor-pointer border ${
                      streamingProviderId === null
                        ? 'bg-violet-500 text-white border-violet-500'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:border-violet-500/40 hover:text-white'
                    } ${streamingFocusArea === 'filters' && streamingFilterIdx === 0 ? 'ring-2 ring-orange-500 ring-offset-1 ring-offset-zinc-950 scale-105' : ''}`}
                  >
                    All
                  </button>
                  {streamingProviders.map((p, pi) => (
                    <button
                      key={p.id}
                      onClick={() => { setStreamingProviderId(p.id); fetchStreamingCatalog(p.id, 1); }}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold font-mono uppercase tracking-wider transition-all cursor-pointer border ${
                        streamingProviderId === p.id
                          ? 'bg-violet-500/20 text-white border-violet-500'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:border-violet-500/40 hover:text-white'
                      } ${streamingFocusArea === 'filters' && streamingFilterIdx === pi + 1 ? 'ring-2 ring-orange-500 ring-offset-1 ring-offset-zinc-950 scale-105' : ''}`}
                    >
                      {p.logoPath && (
                        <img src={`https://image.tmdb.org/t/p/original${p.logoPath}`} alt={p.name} className="w-4 h-4 rounded-sm object-contain" />
                      )}
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Movie grid */}
            {streamingLoading && streamingMovies.length === 0 ? (
              <div className="flex items-center justify-center py-20 text-zinc-500 text-sm font-mono">
                Loading streaming catalog…
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
                  {streamingMovies.map((movie, i) => (
                    <HoverPreviewCard
                      key={movie.id}
                      movie={movie}
                      isCardFocused={showStreamingView && streamingFocusArea === 'grid' && streamingGridRow === Math.floor(i / STREAMING_COLS) && streamingGridCol === i % STREAMING_COLS}
                      targetPlatform={targetPlatform}
                      gridMode
                      onClick={() => openStreamingMovie(movie)}
                      onPlayClick={() => openStreamingMovie(movie)}
                    />
                  ))}
                </div>
                {streamingPage < streamingTotalPages && (
                  <div className="flex justify-center pt-4">
                    <button
                      onClick={() => fetchStreamingCatalog(streamingProviderId, streamingPage + 1)}
                      disabled={streamingLoading}
                      className="px-8 py-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-white text-xs font-bold font-mono uppercase tracking-wider rounded-xl transition-all cursor-pointer disabled:opacity-50"
                    >
                      {streamingLoading ? 'Loading…' : 'Load More'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : activeTab === 'home' ? (
          selectedTrackerCategory !== null ? (
            /* DEDICATED TRACKER CATEGORY VIEW */
            (() => {
              const cat = trackerCategories.find(c => c.key === selectedTrackerCategory);
              const catMovies = trackerMovies[selectedTrackerCategory] || [];
              return (
                <div className="space-y-8 mt-6">
                  {/* Header */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-violet-500/20 pb-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold tracking-widest uppercase px-3 py-1 rounded-full bg-violet-500/10 text-violet-400">
                          TrackerFlix
                        </span>
                        <span className="text-zinc-500 text-xs">/</span>
                        <span className="text-zinc-300 font-mono text-xs">{cat?.label || selectedTrackerCategory}</span>
                      </div>
                      <h1 className="text-3xl font-black font-sans tracking-tight text-white flex items-center gap-3">
                        {cat?.label || selectedTrackerCategory}
                      </h1>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                        {catMovies.length} titles · trackerflix
                      </span>
                      <button
                        onClick={() => {
                          setSelectedTrackerCategory(null);
                          setFocusRow(1);
                          setFocusCol(0);
                        }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 cursor-pointer"
                      >
                        <X size={13} />
                        <span>Back to All</span>
                      </button>
                    </div>
                  </div>

                  {catMovies.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 border border-dashed border-white/5 bg-white/[0.02] rounded-2xl text-center space-y-4 px-6">
                      <div className="p-4 rounded-full bg-zinc-900 border border-white/5 animate-pulse">
                        <Zap size={28} className="text-violet-400" />
                      </div>
                      <h3 className="text-white font-bold text-sm">No Titles Found</h3>
                      <p className="text-xs text-zinc-400 max-w-md">
                        No content available for this category yet. Check your TrackerFlix connection.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-6 gap-5 select-none">
                        {catMovies.map((mov, idx) => {
                          const isCardFocused = isTvMode && focusRow >= 1 && ((focusRow - 1) * CAT_COLS + focusCol === idx);
                          return (
                            <HoverPreviewCard
                              key={mov.id}
                              id={`tracker-cat-card-${mov.id}`}
                              movie={mov}
                              isCardFocused={isCardFocused}
                              targetPlatform={targetPlatform}
                              gridMode
                              onClick={() => setSelectedMovie(mov)}
                              onPlayClick={() => {
                                if (mov.trackerReleases && mov.trackerReleases.length > 0) {
                                  setQualityPickerMovie(mov);
                                }
                              }}
                              onMouseEnter={() => { if (!isTvMode) setCurrentHeroMovie(mov); }}
                            />
                          );
                        })}
                      </div>
                      {/* Vertical infinite-scroll sentinel */}
                      <VerticalSentinel
                        catKey={cat.key}
                        catLabel={cat.label}
                        exhausted={categoryExhausted[cat.key]}
                        loading={categoryLoadingMore[cat.key]}
                        onVisible={loadMoreCategory}
                      />
                    </>
                  )}
                </div>
              );
            })()
          ) : selectedPathId !== null ? (
            /* DEDICATED LIBRARY CATEGORY VIEW */
            <div className="space-y-8 mt-6">
              {/* Grid Header Details */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono font-bold tracking-widest uppercase px-3 py-1 rounded-full ${
                      targetPlatform === 'tizen-tv' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-orange-500/10 text-orange-400'
                    }`}>
                      Library Source
                    </span>
                    <span className="text-zinc-500 text-xs">/</span>
                    <span className="text-zinc-300 font-mono text-xs truncate max-w-[200px] md:max-w-none">
                      {libraryPaths.find(p => p.id === selectedPathId)?.path}
                    </span>
                  </div>
                  <h1 className="text-3xl font-black font-sans tracking-tight text-white flex items-center gap-3">
                    {libraryPaths.find(p => p.id === selectedPathId)?.category || 'Movies'} Category Index
                  </h1>
                </div>


              </div>

              {/* Grid Display segment */}
              {getLibraryMovies().length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 border border-dashed border-white/5 bg-white/[0.02] rounded-2xl text-center space-y-4 px-6 select-none">
                  <div className="p-4 rounded-full bg-zinc-900 border border-white/5 animate-pulse">
                    <Film size={28} className="text-zinc-500" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-white font-bold text-sm">No Resolved Media Found</h3>
                    <p className="text-xs text-zinc-400 max-w-md">
                      The catalog analyzer has not verified matches for "{libraryPaths.find(p => p.id === selectedPathId)?.path}" yet. Try running a directory link synchronization.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => triggerFolderScan(() => {})}
                      className={`px-5 py-2.5 rounded-xl text-xs font-bold uppercase ${
                        targetPlatform === 'tizen-tv' ? 'bg-cyan-400 text-black' : 'bg-orange-500 text-black'
                      } shadow-lg transition-all transform hover:scale-105`}
                    >
                      Trigger Library Sync
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('settings');
                        setSelectedPathId(null);
                      }}
                      className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase bg-zinc-900 hover:bg-zinc-850 text-white border border-white/5 transition-all"
                    >
                      Configure Paths
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-6 gap-5 select-none">
                  {getLibraryMovies().map((movie, idx) => {
                    const isCardFocused = isTvMode && focusRow >= 1 && ((focusRow - 1) * CAT_COLS + focusCol === idx);
                    const uniqueKey = `${movie.id}-${movie.localFilePath || idx}`;
                    return (
                      <HoverPreviewCard
                        key={uniqueKey}
                        id={`library-card-${uniqueKey}`}
                        movie={movie}
                        isCardFocused={isCardFocused}
                        targetPlatform={targetPlatform}
                        gridMode
                        onClick={() => setSelectedMovie(movie)}
                        onPlayClick={() => {
                          const session = findSessionForMovie(movie);
                          if (Capacitor.isNativePlatform()) {
                            playNative(movie, session?.currentTime ?? 0);
                          } else {
                            playWithMPV(movie, session?.currentTime ?? 0);
                          }
                        }}
                        onMouseEnter={() => { if (!isTvMode) setCurrentHeroMovie(movie); }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
            
            {/* HERO CINEMATIC BANNER SPOTLIGHT */}
            <HeroBanner
              movie={currentHeroMovie}
              onPlayClick={(m) => {
                if (m.isLocal && (m.localFilePath || m.sourcePath)) {
                  const session = findSessionForMovie(m);
                  if (Capacitor.isNativePlatform()) {
                    playNative(m, session?.currentTime ?? 0);
                  } else {
                    playWithMPV(m, session?.currentTime ?? 0);
                  }
                } else {
                  setPlayingMovie(m);
                }
              }}
              onInfoClick={(m) => setSelectedMovie(m)}
              isFocused={isTvMode && focusRow === 1}
              targetPlatform={targetPlatform}
            />


            {/* ROW 1: CONTINUE WATCHING SHELF (If playback times recorded) */}
            {playbackSessions.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-lg font-bold tracking-tight mb-4 flex items-center text-white font-sans">
                  <span className="flex items-center gap-2 uppercase font-mono text-xs tracking-wider text-slate-300">
                    <Database size={15} className="text-orange-500" />
                    Continue Watching
                  </span>
                  <div className="ml-4 h-[1px] flex-1 bg-gradient-to-r from-white/10 to-transparent"></div>
                </h2>

                <div id="continue-scroller" className="flex gap-4 overflow-x-auto p-3 -m-3 scrollbar-thin scrollbar-thumb-zinc-900 select-none">
                  {playbackSessions.map((session, index) => {
                    const matched = findLibraryMovieForSession(session);
                    const percent = Math.min(100, Math.floor((session.currentTime / session.duration) * 100));
                    const isCardFocused = isTvMode && focusRow === 2 && focusCol === index;
                    const episodeLabel = getEpisodeLabel(matched);

                    return (
                      <div
                        key={session.movieId}
                        id={`continue-card-${session.movieId}`}
                        data-dpad-focused={isCardFocused ? 'true' : undefined}
                        onClick={() => {
                          if (!matched) return;
                          if (matched.isLocal && (matched.localFilePath || matched.sourcePath)) {
                            if (targetPlatform === 'android-tv') {
                              playNative(matched, session.currentTime);
                            } else {
                              playWithMPV(matched, session.currentTime);
                            }
                          } else {
                            console.warn('[ContinueWatching click] falling back to setPlayingMovie (not local / no path)');
                            setPlayingMovie(matched);
                          }
                        }}
                        onMouseEnter={() => { if (!isTvMode) { matched && setCurrentHeroMovie(matched); } }}
                        className={`relative flex-shrink-0 w-64 sm:w-72 aspect-video bg-zinc-900 border border-white/5 rounded-xl overflow-hidden cursor-pointer hover:shadow-2xl transition-all duration-300 group ${
                          isCardFocused 
                            ? (targetPlatform === 'tizen-tv' 
                                ? 'ring-4 ring-cyan-400 border-cyan-400/55 shadow-[0_0_20px_rgba(34,211,238,0.6)] ring-offset-4 ring-offset-[#050505] scale-105 z-10' 
                                : 'ring-4 ring-orange-500 border-orange-500/55 shadow-[0_0_20px_rgba(249,115,22,0.6)] ring-offset-4 ring-offset-[#050505] scale-105 z-10') 
                            : 'hover:scale-[1.02] opacity-80 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={session.backdropPath}
                          alt={session.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                        {episodeLabel && (
                          <div className={`absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md shadow-lg ${targetPlatform === 'tizen-tv' ? 'bg-cyan-500' : 'bg-orange-500'}`}>
                            <Tv size={8} className="text-black flex-shrink-0" />
                            <span className="text-[8px] font-black font-mono text-black uppercase tracking-wide leading-none">{episodeLabel}</span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent flex flex-col justify-end p-3.5">
                          <span className="font-bold text-white text-xs sm:text-sm tracking-wide truncate">{session.title}</span>
                          <span className="text-[10px] font-mono text-zinc-400 mt-0.5">
                            {episodeLabel ? `${episodeLabel} · Resume playing` : 'Resume playing'}
                          </span>
                        </div>

                        {/* Watch duration bar overlay */}
                        <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20 rounded-full overflow-hidden">
                          <div className={`${targetPlatform === 'tizen-tv' ? 'bg-cyan-400' : 'bg-orange-500'} h-full transition-all duration-300`} style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ROW 3: RECENTLY ADDED */}
            {recentlyAdded.length > 0 && (
              <section id="row-recently-added" className="space-y-4 bg-black/10 border border-white/[0.02] p-5 rounded-2xl">
                <h2 className="text-lg font-bold tracking-tight mb-4 flex items-center text-white font-sans">
                  <span className="flex items-center gap-2 uppercase font-mono text-xs tracking-wider text-slate-300">
                    <Star size={15} className={targetPlatform === 'tizen-tv' ? 'text-cyan-400' : 'text-orange-500'} />
                    Recently Added
                  </span>
                  <div className="ml-4 h-[1px] flex-1 bg-gradient-to-r from-white/10 to-transparent"></div>
                  <span className="text-[10px] text-zinc-500 font-mono tracking-widest lowercase ml-3">latest {recentlyAdded.length} files</span>
                </h2>

                <div id="recently-added-scroller" className="flex gap-[1.2vw] overflow-x-auto overflow-y-visible px-4 py-8 -mx-4 -my-8 scrollbar-thin scrollbar-thumb-zinc-900 select-none">
                  {recentlyAdded.map((mov, index) => {
                    const isCardFocused = isTvMode && focusRow === (playbackSessions.length > 0 ? 3 : 2) && focusCol === index;
                    const episodeLabel = getEpisodeLabel(mov);

                    return (
                      <div
                        key={`recently-${mov.id}`}
                        id={`recently-card-${mov.id}`}
                        data-dpad-focused={isCardFocused ? 'true' : undefined}
                        className={`relative flex-shrink-0 w-[13vw] min-w-[110px] max-w-[180px] cursor-pointer group transition-all duration-300 ${isCardFocused ? (targetPlatform === 'tizen-tv' ? 'ring-4 ring-cyan-400 ring-offset-2 ring-offset-[#050505] scale-105 z-10 rounded-xl' : 'ring-4 ring-orange-500 ring-offset-2 ring-offset-[#050505] scale-105 z-10 rounded-xl') : 'hover:scale-[1.04]'}`}
                        onClick={() => setSelectedMovie(mov)}
                        onMouseEnter={() => { if (!isTvMode) { setCurrentHeroMovie(mov); } }}
                      >
                        <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-zinc-900 border border-white/5">
                          <img
                            src={mov.posterPath}
                            alt={mov.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                          {/* NEW badge top-left, or episode badge if this is a TV episode */}
                          {episodeLabel ? (
                            <div className="absolute top-2 left-2 flex items-center gap-1 bg-orange-500 text-black text-[8px] font-black font-mono px-1.5 py-0.5 rounded-sm uppercase tracking-widest">
                              <Tv size={8} className="flex-shrink-0" />
                              {episodeLabel}
                            </div>
                          ) : (
                            <div className="absolute top-2 left-2 bg-orange-500 text-black text-[8px] font-black font-mono px-1.5 py-0.5 rounded-sm uppercase tracking-widest">NEW</div>
                          )}
                          {/* Rating top-right */}
                          {mov.rating > 0 && (
                            <div className="absolute top-2 right-2 bg-black/70 text-yellow-400 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-sm">★ {mov.rating}</div>
                          )}
                          {/* Hover overlay */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-2">
                            <span className="text-white text-[10px] font-bold truncate">{mov.title}</span>
                            <span className="text-zinc-400 text-[8px] font-mono">
                              {episodeLabel ? `${episodeLabel} · ${mov.fileType} · ${mov.fileSize}` : `${mov.fileType} · ${mov.fileSize}`}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ROW 4+: PER-CATEGORY LIBRARY ROWS */}
            {libraryPaths.map((libPath, pathIndex) => {
              const normalizeShelf = (p?: string) => (p || '').toUpperCase().replace(/[\\\/]+/g, '/').replace(/\/+$/, '');
              const pathNormShelf = normalizeShelf(libPath.path);
              const categoryMovies = groupMoviesByShow(companionScannedMovies.filter(m =>
                (normalizeShelf(m.localFilePath).startsWith(pathNormShelf) && pathNormShelf.length > 0) ||
                (normalizeShelf(m.sourcePath).startsWith(pathNormShelf) && pathNormShelf.length > 0)
              ));
              if (categoryMovies.length === 0) return null;
              const rowIndex = (playbackSessions.length > 0 ? 4 : 3) + pathIndex;

              return (
                <section key={libPath.id} id={`row-${rowIndex}`} className="space-y-4 mt-8 bg-black/10 border border-white/[0.02] p-5 rounded-2xl">
                  <h2 className="text-lg font-bold tracking-tight mb-4 flex items-center text-white font-sans">
                    <span className="flex items-center gap-2 uppercase font-mono text-xs tracking-wider text-slate-300">
                      <Server size={15} className="text-orange-500" />
                      {libPath.category || 'Library'}
                    </span>
                    <div className="ml-4 h-[1px] flex-1 bg-gradient-to-r from-white/10 to-transparent"></div>
                    <span className="text-[10px] font-mono tracking-widest lowercase ml-3">
                      {categoryMovies.length} files · service: <span className={companionStatus === 'connected' ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>{companionStatus.toUpperCase()}</span>
                    </span>
                  </h2>

                  <motion.div layout id={`category-scroller-${libPath.id}`} className="flex gap-[1.2vw] overflow-x-auto overflow-y-visible px-4 py-8 -mx-4 -my-8 scrollbar-thin scrollbar-thumb-zinc-900 select-none">
                    {categoryMovies.map((mov, index) => {
                      const isCardFocused = isTvMode && !selectedPathId && focusRow === rowIndex && focusCol === index;

                      return (
                        <HoverPreviewCard
                          key={`cat-${libPath.id}-${mov.localFilePath || index}`}
                          id={`companion-card-${mov.id}`}
                          movie={mov}
                          isCardFocused={isCardFocused}
                          targetPlatform={targetPlatform}
                          onClick={() => setSelectedMovie(mov)}
                          onPlayClick={() => {
                            const eps = parseEpisodesFromMovie(mov.localFilePath ?? '', (mov as any).episodePaths ?? []);
                            if (eps.length > 1) {
                              setEpisodeSelectShow(mov);
                            } else if (targetPlatform === 'android-tv') {
                              playNative(mov);
                            } else {
                              playWithMPV(mov);
                            }
                          }}
                          onMouseEnter={() => { if (!isTvMode) { setCurrentHeroMovie(mov); } }}
                          onTracksReady={(movieId, tracks) => setPrefetchedTracks(prev => ({ ...prev, [movieId]: tracks }))}
                        />
                      );
                    })}
                  </motion.div>
                </section>
              );
            })}

            {/* RECENTLY DOWNLOADED ROW */}
            {recentlyDownloaded.length > 0 && (
              <section className="space-y-4 mt-8 bg-black/10 border border-violet-500/10 p-5 rounded-2xl">
                <h2 className="text-lg font-bold tracking-tight mb-4 flex items-center text-white font-sans">
                  <span className="flex items-center gap-2 uppercase font-mono text-xs tracking-wider text-slate-300">
                    <Download size={15} className="text-violet-400" />
                    Recently Downloaded
                  </span>
                  <div className="ml-4 h-[1px] flex-1 bg-gradient-to-r from-violet-500/20 to-transparent"></div>
                  <span className="text-[10px] text-zinc-500 font-mono tracking-widest lowercase ml-3">{recentlyDownloaded.length} titles</span>
                </h2>
                <div className="flex gap-[1.2vw] overflow-x-auto overflow-y-visible px-4 py-8 -mx-4 -my-8 scrollbar-thin scrollbar-thumb-zinc-900 select-none">
                  {recentlyDownloaded.map((mov) => (
                    <HoverPreviewCard
                      key={`dl-${mov.id}`}
                      id={`dl-card-${mov.id}`}
                      movie={mov}
                      isCardFocused={false}
                      targetPlatform={targetPlatform}
                      onClick={() => setSelectedMovie(mov)}
                      onPlayClick={() => {
                        if (mov.isTrackerItem && mov.trackerReleases && mov.trackerReleases.length > 0) {
                          // Has releases — go through quality picker → SSE → MPV
                          setQualityPickerMovie(mov);
                        } else if (mov.isTrackerItem && mov.trackerItemId) {
                          // Completed download — use /api/downloaded/play SSE which
                          // sends filePath in the ready event → MPV opens directly
                          const itemId = mov.trackerItemId;
                          setBufferingMovie(mov);
                          setBufferingPhase('Opening downloaded file…');
                          const es = new EventSource(`${trackerFlixHost}/api/downloaded/play/${itemId}`);
                          es.onmessage = (e) => {
                            try {
                              const msg = JSON.parse(e.data);
                              if (msg.type === 'phase') {
                                setBufferingPhase(msg.label || '');
                              } else if (msg.type === 'ready') {
                                es.close();
                                setBufferingMovie(null);
                                if (msg.filePath) {
                                  if (targetPlatform === 'android-tv') {
                                    playNative({ ...mov, localFilePath: msg.filePath, trailerUrl: msg.filePath });
                                  } else {
                                    playWithMPV({ ...mov, localFilePath: msg.filePath, trailerUrl: msg.filePath });
                                  }
                                }
                              } else if (msg.type === 'error') {
                                es.close();
                                setBufferingMovie(null);
                                setMpvError(msg.message || 'Playback error');
                              }
                            } catch {}
                          };
                          es.onerror = () => { es.close(); setBufferingMovie(null); };
                        } else {
                          if (targetPlatform === 'android-tv') {
                            playNative(mov);
                          } else {
                            playWithMPV(mov);
                          }
                        }
                      }}
                      onMouseEnter={() => { if (!isTvMode) { setCurrentHeroMovie(mov); } }}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* TRACKERFLIX CATEGORY ROWS */}
            {(() => {
              // Compute the row index where tracker rows start — must match handleDpadDown/handleDpadRight
              const _hasContinue = playbackSessions.length > 0;
              const _hasRecentlyAdded = recentlyAdded.length > 0;
              const _recentlyAddedRow = _hasContinue ? 3 : 2;
              const _firstLibRow = _hasRecentlyAdded ? _recentlyAddedRow + 1 : _recentlyAddedRow;
              const norm = (p?: string) => (p || '').toUpperCase().replace(/[\\\/]+/g, '/').replace(/\/+$/, '');
              const _visibleLibCount = libraryPaths.filter(lp =>
                companionScannedMovies.some(m =>
                  norm(m.localFilePath).startsWith(norm(lp.path)) ||
                  norm(m.sourcePath).startsWith(norm(lp.path))
                )
              ).length;
              const _lastLibRow = _visibleLibCount > 0
                ? _firstLibRow + _visibleLibCount - 1
                : _hasRecentlyAdded ? _recentlyAddedRow : _hasContinue ? 2 : 1;
              const firstTrackerRow = _lastLibRow + 1;

              let trackerVisibleIdx = 0;
              return trackerCategories.map((cat) => {
                const catMovies = trackerMovies[cat.key] || [];
                if (catMovies.length === 0) return null;
                const rowIndex = firstTrackerRow + trackerVisibleIdx;
                trackerVisibleIdx++;
                return (
                  <section key={cat.key} id={`row-${rowIndex}`} className="space-y-4 mt-8 bg-black/10 border border-violet-500/10 p-5 rounded-2xl">
                    <h2 className="text-lg font-bold tracking-tight mb-4 flex items-center text-white font-sans">
                      <span className="flex items-center gap-2 uppercase font-mono text-xs tracking-wider text-slate-300">
                        <Zap size={15} className="text-violet-400" />
                        {cat.label}
                      </span>
                      <div className="ml-4 h-[1px] flex-1 bg-gradient-to-r from-violet-500/20 to-transparent"></div>
                      <span className="text-[10px] text-zinc-500 font-mono tracking-widest lowercase ml-3">{catMovies.length} titles · trackerflix</span>
                    </h2>
                  <div id={`tracker-scroller-${cat.key}`} className="flex gap-[1.2vw] overflow-x-auto overflow-y-visible px-4 py-8 -mx-4 -my-8 scrollbar-thin scrollbar-thumb-zinc-900 select-none">
                      {catMovies.map((mov, movIdx) => {
                        const isCardFocused = isTvMode && focusRow === rowIndex && focusCol === movIdx;
                        return (
                          <HoverPreviewCard
                            key={mov.id}
                            id={`tracker-card-${mov.id}`}
                            movie={mov}
                            isCardFocused={isCardFocused}
                            targetPlatform={targetPlatform}
                            onClick={() => setSelectedMovie(mov)}
                            onPlayClick={() => {
                              if (mov.trackerReleases && mov.trackerReleases.length > 0) {
                                setQualityPickerMovie(mov);
                              }
                            }}
                            onMouseEnter={() => { if (!isTvMode) { setCurrentHeroMovie(mov); } }}
                          />
                        );
                      })}
                      {/* Horizontal infinite-scroll sentinel */}
                      <HorizontalSentinel
                        catKey={cat.key}
                        catLabel={cat.label}
                        exhausted={categoryExhausted[cat.key]}
                        loading={categoryLoadingMore[cat.key]}
                        onVisible={loadMoreCategory}
                      />
                    </div>
                  </section>
                );
              });
            })()}
          </div>
          )
        ) : (
          /* UNIFIED SETTINGS CONFIGURATION PANEL */
          <div className="animate-in fade-in slide-in-from-bottom-5">
            <SettingsPanel
              libraryPaths={libraryPaths}
              onAddPath={addLibraryPath}
              onRemovePath={removeLibraryPath}
              onTriggerScan={triggerFolderScan}
              playerSettings={playerSettings}
              onUpdatePlayerSettings={updatePlayerSettings}
              tmdbConfig={tmdbConfig}
              onUpdateTMDBConfig={updateTMDBConfig}
              companionHost={companionHost}
              onUpdateCompanionHost={updateCompanionHost}
              companionStatus={companionStatus}
              onTestCompanionConnection={testCompanionConnection}
              companionScannedMovies={companionScannedMovies}
              onTriggerCompanionScan={triggerCompanionScan}
              targetPlatform={targetPlatform}
              onChangeTargetPlatform={updateTargetPlatform}
              tvdbConfig={tvdbConfig}
              onUpdateTVDBConfig={updateTVDBConfig}
              primaryMetadataProvider={primaryMetadataProvider}
              onUpdatePrimaryMetadataProvider={updatePrimaryMetadataProvider}
              trackerFlixHost={trackerFlixHost}
              onUpdateTrackerFlixHost={updateTrackerFlixHost}
              trackerFlixStatus={trackerFlixStatus}
              onTestTrackerFlixConnection={testTrackerFlixConnection}
              onDisconnect={() => {
                setIsGateClosed(true);
                setConnectedServerAddress('');
                localStorage.removeItem('strom_gate_open_session');
                localStorage.removeItem('strom_server_address');
                localStorage.removeItem('strom_remember_connection');
                localStorage.removeItem('plexus_companion_host');
              }}
            />
          </div>
        )}
      </main>

      {/* DETAILED MOVIE INFORMATION CARD DRAWER */}
      {selectedMovie && (
        <MovieDetailsModal
          movie={selectedMovie}
          prefetchedTracks={prefetchedTracks[selectedMovie.id] || null}
          playbackSession={findSessionForMovie(selectedMovie) || null}
          onMovieUpdate={handleMovieUpdate}
          onPlayClick={(m, startTime, audioTrack, subtitleTrack) => {
            setSelectedMovie(null);
            if (m.isTrackerItem && m.trackerReleases && m.trackerReleases.length > 0) {
              // Has quality options — show picker → SSE → MPV
              setQualityPickerMovie(m);
            } else if (m.isLocal && (m.localFilePath || m.sourcePath)) {
              // Local library file → ExoPlayer on Android, MPV on Windows
              if (Capacitor.isNativePlatform()) {
                playNative(m, startTime ?? 0, audioTrack ?? -1, subtitleTrack ?? -1);
              } else {
                playWithMPV(m, startTime ?? 0, audioTrack, subtitleTrack);
              }
            } else if (m.isTrackerItem && m.trackerItemId) {
              // Completed tracker item with no releases — use downloaded play endpoint
              setBufferingMovie(m);
              setBufferingPhase('Opening downloaded file…');
              const es = new EventSource(`${trackerFlixHost}/api/downloaded/play/${m.trackerItemId}`);
              es.onmessage = (e) => {
                try {
                  const msg = JSON.parse(e.data);
                  if (msg.type === 'phase') {
                    setBufferingPhase(msg.label || '');
                  } else if (msg.type === 'ready') {
                    es.close();
                    setBufferingMovie(null);
                    if (msg.filePath) {
                      if (targetPlatform === 'android-tv') {
                        playNative({ ...m, localFilePath: msg.filePath, trailerUrl: msg.filePath });
                      } else {
                        playWithMPV({ ...m, localFilePath: msg.filePath, trailerUrl: msg.filePath });
                      }
                    }
                  } else if (msg.type === 'error') {
                    es.close();
                    setBufferingMovie(null);
                    setMpvError(msg.message || 'Playback error');
                  }
                } catch {}
              };
              es.onerror = () => { es.close(); setBufferingMovie(null); };
            } else {
              // Trailer or unknown — browser player as last resort
              setPlayingMovie(m);
            }
          }}
          onPlayEpisode={(episode: ParsedEpisode, show: Movie) => {
            setSelectedMovie(null);
            const epLabel = episode.season > 0
              ? `S${episode.season} E${episode.episode}`
              : `E${episode.episode}`;
            const epTitle = `${show.title} — ${epLabel}`;
            const epMovie = { ...show, localFilePath: episode.filePath, title: epTitle, id: episode.id ?? show.id };
            const session = findSessionForMovie(epMovie);
            if (Capacitor.isNativePlatform()) {
              playNative(epMovie, session?.currentTime ?? 0);
            } else {
              playWithMPV(epMovie, session?.currentTime ?? 0);
            }
          }}
          onClose={() => setSelectedMovie(null)}
          isFocused={false}
        />
      )}

      {/* EPISODE SELECT MODAL — shown when a multi-episode TV show poster is clicked */}
      {episodeSelectShow && (() => {
        const eps = parseEpisodesFromMovie(
          episodeSelectShow.localFilePath ?? '',
          (episodeSelectShow as any).episodePaths ?? []
        );
        return (
          <EpisodeSelectModal
            show={episodeSelectShow}
            episodes={eps}
            targetPlatform={targetPlatform}
            onPlayEpisode={(episode, show) => {
              setEpisodeSelectShow(null);
              const epLabel = episode.season > 0
                ? `S${episode.season} E${episode.episode}`
                : `E${episode.episode}`;
              const epTitle = `${show.title} — ${epLabel}`;
              const epMovie = { ...show, localFilePath: episode.filePath, title: epTitle, id: episode.id ?? show.id };
              const session = findSessionForMovie(epMovie);
              if (Capacitor.isNativePlatform()) {
                playNative(epMovie, session?.currentTime ?? 0);
              } else {
                playWithMPV(epMovie, session?.currentTime ?? 0);
              }
            }}
            onClose={() => setEpisodeSelectShow(null)}
          />
        );
      })()}

      {/* QUALITY PICKER — shown on top of details modal for tracker items */}
      {qualityPickerMovie && (
        <QualityPickerModal
          movie={qualityPickerMovie}
          onSelect={(releaseId) => {
            startTrackerPlay(qualityPickerMovie, releaseId);
            setQualityPickerMovie(null);
          }}
          onClose={() => setQualityPickerMovie(null)}
        />
      )}

      {/* TRACK PICKER MODAL — shown after SSE ready fires for torrents with multiple tracks */}
      {pendingPlay && (
        <TrackPickerModal
          movie={pendingPlay.movie}
          tracks={pendingPlay.tracks}
          onPlay={(audioTrack, subtitleTrack) => {
            if (targetPlatform === 'android-tv') {
              playNative(pendingPlay.movie, 0, audioTrack ?? -1, subtitleTrack ?? -1);
            } else {
              playWithMPV(pendingPlay.movie, 0, audioTrack, subtitleTrack);
            }
            setPendingPlay(null);
          }}
          onClose={() => setPendingPlay(null)}
        />
      )}

      {/* BUFFERING OVERLAY — shown while SSE is connecting/buffering */}
      {bufferingMovie && (
        <div className="fixed inset-0 z-[115] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
          <div className="relative z-10 flex flex-col items-center gap-4 max-w-sm w-full">
            {/* Poster */}
            <img
              src={bufferingMovie.posterPath}
              alt={bufferingMovie.title}
              className="w-28 rounded-xl shadow-2xl border border-white/10"
            />
            <div className="text-center">
              <h3 className="text-white font-bold text-sm">{bufferingMovie.title}</h3>
              <p className="text-violet-300 text-xs font-mono mt-1">{bufferingPhase}</p>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-violet-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${bufferingPct}%` }}
              />
            </div>
            {bufferingSpeed && (
              <div className="flex items-center gap-4 text-[10px] font-mono text-zinc-400">
                <span>↓ {bufferingSpeed}</span>
                <span>{bufferingPeers} peers</span>
              </div>
            )}
            <button
              onClick={() => {
                if (trackerSSERef.current) { trackerSSERef.current.close(); trackerSSERef.current = null; }
                setBufferingMovie(null);
              }}
              className="text-zinc-500 hover:text-white text-[10px] font-mono uppercase tracking-wider cursor-pointer transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}



      {/* MPV LAUNCHING TOAST */}
      {mpvLaunching && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 bg-zinc-950/95 border border-orange-500/30 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-3">
          <div className="w-3 h-3 rounded-full bg-orange-500 animate-ping" />
          <span className="text-xs font-mono text-orange-400 font-bold uppercase tracking-widest">Launching MPV...</span>
        </div>
      )}

      {/* MPV ERROR TOAST */}
      {mpvError && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 bg-zinc-950/95 border border-red-500/30 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-3">
          <span className="text-xs font-mono text-red-400 font-bold uppercase tracking-widest">{mpvError}</span>
          <button onClick={() => setMpvError(null)} className="text-zinc-500 hover:text-white text-xs font-mono cursor-pointer">✕</button>
        </div>
      )}

      {/* BROWSER VIDEO PLAYER — only for trailers and tracker HLS streams (not local files) */}
      {playingMovie && (
        <CinemaVideoPlayer
          movie={playingMovie}
          settings={playerSettings}
          localVideoFile={localVideoFile}
          onClose={() => setPlayingMovie(null)}
          onUpdateSession={updateSession}
        />
      )}

    </div>
    </ActivePreviewProvider>
  );
}

// ---------------------------------------------------------------------------
// TorrentWidget — lives in top nav, with pause/resume/stop/delete per torrent
// ---------------------------------------------------------------------------
function TorrentWidget({ host, forceOpen = false }: { host: string; forceOpen?: boolean }) {
  const [data, setData] = useState<any>(null);
  const [expanded, setExpanded] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // D-pad internal navigation — use refs so the single stable handler always
  // reads current values without needing to re-register on every state change.
  const [torrentIdx, setTorrentIdx] = useState(0);
  const [actionIdx, setActionIdx] = useState(0);
  const torrentIdxRef = useRef(0);
  const actionIdxRef = useRef(0);
  const confirmDeleteRef = useRef<string | null>(null);
  const dataRef = useRef<any>(null);
  const forceOpenRef = useRef(false);

  // Keep refs in sync with state/props
  useEffect(() => { torrentIdxRef.current = torrentIdx; }, [torrentIdx]);
  useEffect(() => { actionIdxRef.current = actionIdx; }, [actionIdx]);
  useEffect(() => { confirmDeleteRef.current = confirmDelete; }, [confirmDelete]);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { forceOpenRef.current = forceOpen; }, [forceOpen]);

  // Open when D-pad lands here, reset internal focus to first torrent
  useEffect(() => {
    if (forceOpen) {
      setExpanded(true);
      setTorrentIdx(0);
      setActionIdx(0);
      torrentIdxRef.current = 0;
      actionIdxRef.current = 0;
    } else {
      setExpanded(false);
      setConfirmDelete(null);
      confirmDeleteRef.current = null;
    }
  }, [forceOpen]);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${host}/api/torrents/active`);
        if (res.ok) {
          const d = await res.json();
          setData(d);
          dataRef.current = d;
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [host]);

  // Expose D-pad navigation handlers via window.__torrentWidgetNav so both
  // keyboard input (via App's global handler) AND on-screen remote button
  // clicks (via App's unified handlers) can drive widget navigation.
  // Each handler returns true if it consumed the action, false to let App handle it.
  useEffect(() => {
    const nav = {
      up: (): boolean => {
        // At first row → release to App so it can navigate out
        if (torrentIdxRef.current <= 0) return false;
        const next = torrentIdxRef.current - 1;
        torrentIdxRef.current = next;
        actionIdxRef.current = 0;
        confirmDeleteRef.current = null;
        setTorrentIdx(next);
        setActionIdx(0);
        setConfirmDelete(null);
        return true;
      },
      down: (): boolean => {
        const torrents = dataRef.current?.torrents || [];
        const total = torrents.length;
        // At last row → release to App so it can navigate down to hero/grid
        if (torrentIdxRef.current >= total - 1) return false;
        const next = torrentIdxRef.current + 1;
        torrentIdxRef.current = next;
        actionIdxRef.current = 0;
        confirmDeleteRef.current = null;
        setTorrentIdx(next);
        setActionIdx(0);
        setConfirmDelete(null);
        return true;
      },
      right: (): boolean => {
        const inConfirm = confirmDeleteRef.current !== null;
        const actionCount = inConfirm ? 2 : 3;
        // At last action button → consume (don't navigate off the right edge of the header)
        if (actionIdxRef.current >= actionCount - 1) return true;
        const next = actionIdxRef.current + 1;
        actionIdxRef.current = next;
        setActionIdx(next);
        return true;
      },
      left: (): boolean => {
        // At first action button → release to App so it can go back to col 0
        if (actionIdxRef.current <= 0) return false;
        const next = actionIdxRef.current - 1;
        actionIdxRef.current = next;
        setActionIdx(next);
        return true;
      },
      select: (): boolean => {
        const torrents = dataRef.current?.torrents || [];
        const t = torrents[torrentIdxRef.current];
        if (!t) return false;
        const inConfirm = confirmDeleteRef.current !== null;
        if (inConfirm) {
          if (actionIdxRef.current === 0) {
            confirmDeleteRef.current = null;
            setConfirmDelete(null);
            torrentAction(t.infoHash, 'delete');
          } else {
            confirmDeleteRef.current = null;
            setConfirmDelete(null);
          }
        } else {
          if (actionIdxRef.current === 0) torrentAction(t.infoHash, t.status === 'paused' ? 'resume' : 'pause');
          else if (actionIdxRef.current === 1) torrentAction(t.infoHash, 'stop');
          else if (actionIdxRef.current === 2) {
            confirmDeleteRef.current = t.infoHash;
            actionIdxRef.current = 0;
            setConfirmDelete(t.infoHash);
            setActionIdx(0);
          }
        }
        return true;
      },
    };

    if (forceOpen) {
      (window as any).__torrentWidgetNav = nav;
    } else {
      if ((window as any).__torrentWidgetNav === nav) {
        delete (window as any).__torrentWidgetNav;
      }
    }

    // Keyboard listener — only registered when widget is focused.
    // Only preventDefault/stopPropagation when nav actually consumed the action.
    const handleKeys = (e: KeyboardEvent) => {
      const map: Record<string, keyof typeof nav> = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'select',
      };
      const action = map[e.key];
      if (!action) return;
      if (!forceOpen) return;
      const consumed = nav[action]();
      if (consumed) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    if (forceOpen) {
      window.addEventListener('keydown', handleKeys, true);
    }

    return () => {
      window.removeEventListener('keydown', handleKeys, true);
      if ((window as any).__torrentWidgetNav === nav) {
        delete (window as any).__torrentWidgetNav;
      }
    };
  }, [forceOpen]);

  if (!data || data.total === 0) return null;

  const fmtSpeed = (bps: number) => {
    if (!bps) return '0 B/s';
    if (bps > 1024 * 1024) return (bps / (1024 * 1024)).toFixed(1) + ' MB/s';
    if (bps > 1024) return (bps / 1024).toFixed(0) + ' KB/s';
    return bps + ' B/s';
  };

  const torrentAction = async (infoHash: string, action: 'pause' | 'resume' | 'stop' | 'delete') => {
    // Optimistic local state update so UI reflects change immediately
    if (action === 'pause') {
      setData((prev: any) => prev ? {
        ...prev,
        torrents: prev.torrents.map((t: any) => t.infoHash === infoHash ? { ...t, status: 'paused' } : t)
      } : prev);
    } else if (action === 'resume') {
      setData((prev: any) => prev ? {
        ...prev,
        torrents: prev.torrents.map((t: any) => t.infoHash === infoHash ? { ...t, status: 'downloading' } : t)
      } : prev);
    } else if (action === 'stop' || action === 'delete') {
      setData((prev: any) => prev ? {
        ...prev,
        total: Math.max(0, prev.total - 1),
        torrents: prev.torrents.filter((t: any) => t.infoHash !== infoHash)
      } : prev);
    }

    setActionPending(infoHash + action);
    // Server routes: POST /api/torrents/{action}/{infoHash}, delete maps to remove
    const endpoint = action === 'delete' ? 'remove' : action;
    try {
      await fetch(`${host}/api/torrents/${endpoint}/${infoHash}`, { method: 'POST' });
      // Confirm with real server state after action
      const res = await fetch(`${host}/api/torrents/active`);
      if (res.ok) setData(await res.json());
    } catch {}
    setActionPending(null);
  };

  return (
    <div className="relative font-mono" style={{ zIndex: 60 }}>
      <div className="bg-black/80 backdrop-blur-xl border border-violet-500/30 rounded-xl shadow-2xl overflow-visible">
        {/* Compact header pill */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-2 px-3 py-1.5 w-full cursor-pointer hover:bg-white/5 transition-colors rounded-xl"
        >
          <Zap size={11} className="text-violet-400 flex-shrink-0 animate-pulse" />
          <span className="text-violet-300 text-[10px] font-bold tracking-wider uppercase whitespace-nowrap">
            {data.downloading > 0 ? `↓ ${fmtSpeed(data.totalDlSpeed)}` : ''}
            {data.downloading > 0 && data.seeding > 0 ? ' · ' : ''}
            {data.seeding > 0 ? `↑ ${fmtSpeed(data.totalUlSpeed)}` : ''}
          </span>
          <span className="text-zinc-500 text-[10px] ml-1 whitespace-nowrap">{data.total} active</span>
          <ChevronDown size={11} className={`text-zinc-500 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown */}
        {expanded && (
          <div className="absolute top-full right-0 mt-1 w-80 bg-black/95 backdrop-blur-xl border border-violet-500/20 rounded-xl shadow-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-widest">Active Transfers</span>
              <span className="text-[9px] text-violet-400 font-mono">{data.total} torrents</span>
            </div>
            {forceOpen && (
              <div className="px-3 py-1 bg-violet-500/5 border-b border-violet-500/10 text-[8px] font-mono text-violet-400 tracking-widest flex items-center gap-1.5">
                <span>▲▼ row · ◀▶ action · Enter confirm</span>
              </div>
            )}
            <div className="max-h-72 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden">
              {(data.torrents || []).map((t: any, idx: number) => {
                const isRowFocused = forceOpen && torrentIdx === idx;
                const inConfirm = confirmDelete === t.infoHash;
                return (
                  <div
                    key={t.infoHash}
                    className={`px-3 py-2.5 border-b border-zinc-800/50 last:border-0 transition-colors ${isRowFocused ? 'bg-violet-500/10' : ''}`}
                  >
                    <p className="text-zinc-200 text-[10px] truncate mb-1.5 font-medium">{t.name}</p>
                    {/* Progress bar */}
                    <div className="w-full bg-zinc-800 rounded-full h-1 mb-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          t.status === 'seeding' ? 'bg-emerald-500' :
                          t.status === 'paused'  ? 'bg-zinc-500' : 'bg-violet-500'
                        }`}
                        style={{ width: `${Math.round((t.progress || 0) * 100)}%` }}
                      />
                    </div>

                    {/* Inline delete confirm banner */}
                    {inConfirm ? (
                      <div className="flex items-center justify-between bg-red-500/10 border border-red-500/30 rounded-lg px-2 py-1.5 mt-1">
                        <span className="text-[9px] text-red-300 font-mono">Remove this torrent?</span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); torrentAction(t.infoHash, 'delete'); }}
                            className={`px-2 py-0.5 text-[8px] font-bold uppercase rounded bg-red-500 hover:bg-red-400 text-white cursor-pointer transition-all ${isRowFocused && actionIdx === 0 ? 'ring-2 ring-white ring-offset-1 ring-offset-black scale-110' : ''}`}
                          >Yes</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                            className={`px-2 py-0.5 text-[8px] font-bold uppercase rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 cursor-pointer transition-all ${isRowFocused && actionIdx === 1 ? 'ring-2 ring-white ring-offset-1 ring-offset-black scale-110' : ''}`}
                          >No</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[9px]">
                          <span className={
                            t.status === 'seeding'  ? 'text-emerald-400' :
                            t.status === 'paused'   ? 'text-zinc-400' : 'text-violet-400'
                          }>
                            {t.status === 'seeding' ? '✓ seeding' : t.status === 'paused' ? '⏸ paused' : `${Math.round((t.progress || 0) * 100)}%`}
                          </span>
                          <span className="text-zinc-500">{fmtSpeed(t.dlSpeed)} · {t.numPeers}p</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {/* Pause / Resume */}
                          <button
                            onClick={(e) => { e.stopPropagation(); torrentAction(t.infoHash, t.status === 'paused' ? 'resume' : 'pause'); }}
                            disabled={actionPending !== null}
                            className={`px-1.5 py-0.5 text-[8px] font-bold rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 transition-all cursor-pointer disabled:opacity-40 ${isRowFocused && actionIdx === 0 ? 'ring-2 ring-violet-400 border-violet-400 text-white scale-110' : ''}`}
                            title={t.status === 'paused' ? 'Resume' : 'Pause'}
                          >
                            {t.status === 'paused' ? '▶' : '⏸'}
                          </button>
                          {/* Stop */}
                          <button
                            onClick={(e) => { e.stopPropagation(); torrentAction(t.infoHash, 'stop'); }}
                            disabled={actionPending !== null}
                            className={`px-1.5 py-0.5 text-[8px] font-bold rounded bg-zinc-800 hover:bg-amber-500/20 text-zinc-300 hover:text-amber-400 border border-zinc-700 hover:border-amber-500/40 transition-all cursor-pointer disabled:opacity-40 ${isRowFocused && actionIdx === 1 ? 'ring-2 ring-amber-400 border-amber-400 text-amber-400 scale-110' : ''}`}
                            title="Stop"
                          >■</button>
                          {/* Delete */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(t.infoHash); }}
                            disabled={actionPending !== null}
                            className={`px-1.5 py-0.5 text-[8px] font-bold rounded bg-zinc-800 hover:bg-red-500/20 text-zinc-300 hover:text-red-400 border border-zinc-700 hover:border-red-500/40 transition-all cursor-pointer disabled:opacity-40 ${isRowFocused && actionIdx === 2 ? 'ring-2 ring-red-400 border-red-400 text-red-400 scale-110' : ''}`}
                            title="Delete"
                          >✕</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
