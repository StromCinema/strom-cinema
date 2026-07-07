export interface Movie {
  id: string;
  title: string;
  originalTitle?: string;
  backdropPath: string;
  posterPath: string;
  overview: string;
  rating: number;
  releaseDate: string;
  runtime: number;
  genres: string[];
  tagline?: string;
  trailerUrl?: string;
  actors?: string[];
  director?: string;
  isLocal?: boolean;
  localFilePath?: string;
  fileSize?: string;
  fileType?: string;
  addedAt?: number;
  sourcePath?: string;
  // TrackerFlix fields
  isTrackerItem?: boolean;
  trackerItemId?: string;
  trackerCategory?: string;
  trackerSeeders?: number;
  trackerSize?: string;
  trackerReleases?: TrackerRelease[];
}

export interface TrackerRelease {
  id: string;
  label: string;
  quality: string;
  size: string;
  seeders: number;
}

export interface TrackerCategory {
  key: string;
  label: string;
}

export interface TrackerFlixConfig {
  host: string;
  isEnabled: boolean;
  status: 'untested' | 'connecting' | 'connected' | 'failed';
}

export interface LibraryPath {
  id: string;
  path: string;
  deviceType: 'internal' | 'external' | 'custom';
  category?: string;
  scannedAt?: string;
  fileCount: number;
}

export interface LocalFile {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: string;
  fileType: string;
  addedAt: string;
  matchedMovieId?: string;
}

export interface PlaybackSession {
  movieId: string;
  // Local files are the one thing guaranteed stable across rescans/caches —
  // movieId can drift between the different Movie-object sources (companion
  // scan vs. stale cached local scan vs. tracker/recently-added), so we key
  // resume lookups off localFilePath first when it's available and only
  // fall back to movieId for non-local / tracker items that have no path.
  localFilePath?: string;
  title: string;
  posterPath: string;
  backdropPath: string;
  currentTime: number;
  duration: number;
  lastPlayedAt: string;
}

export interface PlayerSettings {
  useHardwareDecoding: boolean;
  aspectRatio: 'fit' | 'fill' | 'stretch' | 'zoom';
  subtitleSize: number;
  subtitleColor: string;
  subtitleBackgroundColor: string;
  audioDelay: number;
  playbackSpeed: number;
  quality: 'auto' | '1080p' | '720p' | '480p';
}

export interface TMDBConfig {
  apiKey: string;
  isEnabled: boolean;
  language: string;
}

export interface TVDBConfig {
  apiKey: string;
  isEnabled: boolean;
  userKey?: string;
}

export interface SubTrack {
  id: number;
  language: string;
  title: string;
  codec: string;
}

export interface AudioTrack {
  id: number;
  language: string;
  title: string;
  codec: string;
  channels: number;
}

export interface TrackInfo {
  subtitles: SubTrack[];
  audioTracks: AudioTrack[];
  videoInfo?: {
    width: number;
    height: number;
    resolution: string | null;
    codec: string | null;
    hdr: string | null;
  };
  audioLabel?: string | null;
}
