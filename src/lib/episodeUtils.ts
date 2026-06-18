/**
 * episodeUtils.ts
 * Parses local media file paths and names to detect TV show episodes,
 * group them by show name, and sort by season/episode number.
 *
 * Supported naming formats:
 *   - Show.Name.S01E01.mkv
 *   - Show Name - 1x02.mp4
 *   - Show Name/Season 1/Episode 01.mkv
 *   - Show.Name.S01E01E02.mkv  (multi-episode file)
 *   - Show Name - S2E5 - Title.mkv
 */

export interface ParsedEpisode {
  /** Display title derived from filename or metadata */
  title: string;
  /** Season number (1-based). 0 if unknown. */
  season: number;
  /** Episode number (1-based). 0 if unknown. */
  episode: number;
  /** Original file path / stream source */
  filePath: string;
  /** Optional runtime in minutes */
  runtime?: number;
  /** Watch progress 0-1 */
  progress?: number;
  /** Unique id derived from filePath */
  id: string;
}

export interface EpisodeGroup {
  /** Normalised show name used as the group key */
  showName: string;
  episodes: ParsedEpisode[];
}

// ─── Regex patterns ─────────────────────────────────────────────────────────

/** S01E01, S1E1, S01E01E02 */
const RE_SxEy = /[Ss](\d{1,2})[Ee](\d{1,3})/;

/** 1x02, 01x02 */
const RE_1xEy = /(\d{1,2})[xX](\d{2,3})/;

/** /Season 1/ or /Season 01/ in path segments */
const RE_SEASON_DIR = /[Ss]eason\s*(\d{1,2})/;

/** /Episode 01/ in path segments */
const RE_EP_DIR = /[Ee]pisode\s*(\d{1,3})/;

// ─── Core parsers ─────────────────────────────────────────────────────────

/**
 * Attempt to extract { season, episode } numbers from a filename or path.
 * Returns { season: 0, episode: 0 } when nothing is found.
 */
export function parseSeasonEpisode(path: string): { season: number; episode: number } {
  const filename = path.split(/[/\\]/).pop() ?? path;

  // Pattern 1: S01E02 / S1E2
  const m1 = filename.match(RE_SxEy);
  if (m1) return { season: parseInt(m1[1], 10), episode: parseInt(m1[2], 10) };

  // Pattern 2: 1x02
  const m2 = filename.match(RE_1xEy);
  if (m2) return { season: parseInt(m2[1], 10), episode: parseInt(m2[2], 10) };

  // Pattern 3: /Season 1/Episode 03/
  const mSeason = path.match(RE_SEASON_DIR);
  const mEp = path.match(RE_EP_DIR);
  if (mSeason) {
    return {
      season: parseInt(mSeason[1], 10),
      episode: mEp ? parseInt(mEp[1], 10) : 0,
    };
  }

  return { season: 0, episode: 0 };
}

/**
 * Derive a human-readable episode title from a raw filename.
 * Strips the show prefix, season/episode codes, and file extension.
 */
export function deriveEpisodeTitle(filename: string, showName: string): string {
  let name = filename
    .replace(/\.[a-zA-Z0-9]{2,4}$/, '')   // strip extension
    .replace(/[._]/g, ' ')                  // dots/underscores → spaces
    .trim();

  // Remove the show name prefix (case-insensitive)
  const escapedShow = showName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  name = name.replace(new RegExp('^' + escapedShow, 'i'), '').trim();

  // Remove leading dashes/separators left after stripping the show name
  name = name.replace(/^[\s\-–—]+/, '').trim();

  // Remove S01E02 / 1x02 codes and anything before them
  name = name.replace(/[Ss]\d{1,2}[Ee]\d{1,3}/g, '').trim();
  name = name.replace(/\d{1,2}[xX]\d{2,3}/g, '').trim();
  name = name.replace(/[Ss]eason\s*\d+/gi, '').trim();
  name = name.replace(/[Ee]pisode\s*\d+/gi, '').trim();

  // Remove residual leading separators again
  name = name.replace(/^[\s\-–—]+/, '').trim();

  return name || filename.replace(/\.[a-zA-Z0-9]{2,4}$/, '');
}

/**
 * Normalise a show name for use as a grouping key.
 * Converts dots/underscores to spaces, lowercases, and trims.
 */
export function normaliseShowName(raw: string): string {
  return raw
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Extract the show name from a file path.
 * Works by stripping the known S01E01 / 1x02 / Season N portion and everything after.
 */
export function extractShowName(path: string): string {
  const filename = path.split(/[/\\]/).pop() ?? path;

  // Check path for "Show Name/Season N/..." folder structure first
  const segments = path.split(/[/\\]/);
  const seasonIdx = segments.findIndex(s => /^[Ss]eason\s*\d/i.test(s));
  if (seasonIdx > 0) {
    return segments[seasonIdx - 1].replace(/[._]/g, ' ').trim();
  }

  // Strip extension
  let name = filename.replace(/\.[a-zA-Z0-9]{2,4}$/, '');

  // Cut at S01E02
  name = name.split(/[Ss]\d{1,2}[Ee]\d{1,3}/)[0];
  // Cut at 1x02
  name = name.split(/\d{1,2}[xX]\d{2,3}/)[0];

  // Clean up trailing separators / junk
  name = name
    .replace(/[\s.\-_–—]+$/, '')
    .replace(/[._]/g, ' ')
    .trim();

  return name;
}

// ─── Grouping ─────────────────────────────────────────────────────────────

/**
 * Given a list of file paths (or Movie.localFilePath values), group those
 * that look like TV episodes under their show name.
 *
 * Returns a Map keyed by normalised show name.
 */
export function groupEpisodes(filePaths: string[]): Map<string, EpisodeGroup> {
  const groups = new Map<string, EpisodeGroup>();

  for (const filePath of filePaths) {
    const { season, episode } = parseSeasonEpisode(filePath);

    // Only treat as an episode if we found at least an episode number
    if (episode === 0 && season === 0) continue;

    const rawShowName = extractShowName(filePath);
    const key = normaliseShowName(rawShowName);

    const filename = filePath.split(/[/\\]/).pop() ?? filePath;
    const title = deriveEpisodeTitle(filename, rawShowName);

    const parsedEp: ParsedEpisode = {
      id: btoa(filePath).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16),
      title,
      season,
      episode,
      filePath,
    };

    if (!groups.has(key)) {
      groups.set(key, { showName: rawShowName, episodes: [] });
    }
    groups.get(key)!.episodes.push(parsedEp);
  }

  // Sort each group by season then episode
  for (const group of groups.values()) {
    group.episodes.sort((a, b) =>
      a.season !== b.season ? a.season - b.season : a.episode - b.episode
    );
  }

  return groups;
}

/**
 * Convenience: given a single Movie's localFilePath (or array of episode paths
 * stored in the movie object), return sorted ParsedEpisode[].
 * Returns [] if the path does not look like a TV episode.
 */
export function parseEpisodesFromMovie(
  primaryPath: string,
  additionalPaths: string[] = []
): ParsedEpisode[] {
  const all = [primaryPath, ...additionalPaths].filter(Boolean);
  const groups = groupEpisodes(all);

  if (groups.size === 0) return [];

  // Return the first (and usually only) group's episodes
  return groups.values().next().value?.episodes ?? [];
}

// ─── Episode count helpers ─────────────────────────────────────────────────

/** Returns a short badge string like "S1 · 12 EPS" or "3 Episodes" */
export function formatEpisodeBadge(episodes: ParsedEpisode[]): string {
  if (episodes.length === 0) return '';
  const seasons = new Set(episodes.map(e => e.season).filter(s => s > 0));
  if (seasons.size > 1) {
    return `${seasons.size}S · ${episodes.length} EPS`;
  }
  if (seasons.size === 1) {
    const s = [...seasons][0];
    return `S${s} · ${episodes.length} EPS`;
  }
  return episodes.length === 1 ? '1 Episode' : `${episodes.length} Episodes`;
}

/** Sort comparator for episodes */
export function episodeSortKey(ep: ParsedEpisode): number {
  return ep.season * 1000 + ep.episode;
}

// ─── Movie-level grouping ──────────────────────────────────────────────────

/**
 * Group a flat Movie[] so that all episode files belonging to the same TV
 * show collapse into a single representative Movie card.
 *
 * The first episode file encountered becomes the representative card.
 * All sibling paths are attached as `(movie as any).episodePaths` so
 * HoverPreviewCard / EpisodeSelectModal can discover them.
 *
 * Movies that don't look like TV episodes (parseSeasonEpisode returns 0,0)
 * are passed through unchanged.
 */
export function groupMoviesByShow<T extends { localFilePath?: string; title?: string }>(
  movies: T[]
): T[] {
  const result: T[] = [];
  // Map from normalised show name → index in result[]
  const showIndex = new Map<string, number>();

  for (const movie of movies) {
    const filePath = movie.localFilePath ?? '';
    const { season, episode } = parseSeasonEpisode(filePath);

    // Not a detectable episode → pass through
    if (season === 0 && episode === 0) {
      result.push(movie);
      continue;
    }

    const rawShow = extractShowName(filePath);
    const key = normaliseShowName(rawShow);

    if (showIndex.has(key)) {
      // Merge: append this path to the representative card's episodePaths.
      // episodePaths holds ADDITIONAL paths only — localFilePath is the primary
      // and is already passed separately to parseEpisodesFromMovie, so never
      // include it here to avoid a duplicate first episode in the list.
      const idx = showIndex.get(key)!;
      const rep = result[idx] as any;
      if (!rep.episodePaths) rep.episodePaths = [];
      const primaryPath = rep.localFilePath ?? '';
      if (filePath && filePath !== primaryPath && !rep.episodePaths.includes(filePath)) {
        rep.episodePaths.push(filePath);
      }
    } else {
      // First episode seen for this show — becomes the representative card.
      // episodePaths starts empty: localFilePath IS the first episode path and
      // parseEpisodesFromMovie receives it as the primaryPath argument.
      showIndex.set(key, result.length);
      const rep = { ...movie } as any;
      rep.episodePaths = [];
      result.push(rep as T);
    }
  }

  return result;
}
