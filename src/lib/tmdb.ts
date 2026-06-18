import { Movie } from '../types';
import { STATIC_MOVIES } from '../data';

const BASE_URL = 'https://api.themoviedb.org/3';

export async function fetchFromTMDB(endpoint: string, apiKey: string, queryParams: Record<string, string> = {}): Promise<any> {
  if (!apiKey) {
    throw new Error('No TMDB API key configured');
  }

  const isV4Token = apiKey.trim().startsWith('eyJ');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  const cleanParams: Record<string, string> = { ...queryParams };

  if (isV4Token) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  } else {
    cleanParams.api_key = apiKey.trim();
  }

  const queryStr = new URLSearchParams(cleanParams).toString();
  const url = `${BASE_URL}${endpoint}${queryStr ? '?' + queryStr : ''}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`TMDB API call failed: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Searches TMDB for a movie by name.
 */
export async function searchMovieOnTMDB(title: string, year: string | null, apiKey: string): Promise<Movie[]> {
  try {
    const params: Record<string, string> = { query: title };
    if (year) {
      params.primary_release_year = year;
    }
    
    const data = await fetchFromTMDB('/search/movie', apiKey, params);
    if (!data.results || data.results.length === 0) return [];

    return data.results.slice(0, 5).map((m: any) => mapTMDBMovie(m));
  } catch (error) {
    console.warn('TMDB Search Error, using offline match indices instead:', error);
    // Offline text matching as fallback
    const query = title.toLowerCase();
    return STATIC_MOVIES.filter(m => 
      m.title.toLowerCase().includes(query) || 
      (m.originalTitle && m.originalTitle.toLowerCase().includes(query))
    );
  }
}

/**
 * Gets active trending list from TMDB or falls back to static catalog.
 */
export async function getTrendingMovies(apiKey: string): Promise<Movie[]> {
  if (!apiKey) {
    return STATIC_MOVIES;
  }
  try {
    const data = await fetchFromTMDB('/trending/movie/week', apiKey);
    if (!data.results) return STATIC_MOVIES;

    // Fetch details in batches for rich metadata or mapping
    return data.results.slice(0, 15).map((m: any) => mapTMDBMovie(m));
  } catch (error) {
    console.warn('Failed to fetch trending from TMDB:', error);
    return STATIC_MOVIES;
  }
}

/**
 * Appends details like actors, directors, tagline, trailers from TMDB.
 */
export async function getMovieDetails(movieId: string, apiKey: string): Promise<Movie | null> {
  // Check if it's a mock movie first so we don't break mock items
  const localMatch = STATIC_MOVIES.find(m => m.id === movieId);
  
  if (!apiKey) {
    return localMatch || null;
  }

  try {
    const mainData = await fetchFromTMDB(`/movie/${movieId}`, apiKey);
    const creditsData = await fetchFromTMDB(`/movie/${movieId}/credits`, apiKey).catch(() => ({}));
    const videosData = await fetchFromTMDB(`/movie/${movieId}/videos`, apiKey).catch(() => ({}));

    const mapped = mapTMDBMovie(mainData);
    
    // Add additional fields from credits and videos
    if (creditsData.cast) {
      mapped.actors = creditsData.cast.slice(0, 5).map((c: any) => c.name);
    }
    if (creditsData.crew) {
      const directorObj = creditsData.crew.find((c: any) => c.job === 'Director');
      if (directorObj) {
        mapped.director = directorObj.name;
      }
    }
    if (videosData.results) {
      const trailer = videosData.results.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');
      if (trailer) {
        mapped.trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
      }
    }

    return mapped;
  } catch (error) {
    console.warn('Failed to fetch movie details from TMDB:', error);
    return localMatch || null;
  }
}

/**
 * Fetches trailer URL (and basic details) for a TV show from TMDB.
 * Uses /tv/{id} endpoints instead of /movie/{id}.
 */
export async function getTvDetails(tvId: string, apiKey: string): Promise<Movie | null> {
  try {
    const mainData = await fetchFromTMDB(`/tv/${tvId}`, apiKey);
    const creditsData = await fetchFromTMDB(`/tv/${tvId}/credits`, apiKey).catch(() => ({}));
    const videosData = await fetchFromTMDB(`/tv/${tvId}/videos`, apiKey).catch(() => ({}));

    const mapped = mapTMDBMovie({
      ...mainData,
      title: mainData.name,
      release_date: mainData.first_air_date,
    });

    if (creditsData.cast) {
      mapped.actors = creditsData.cast.slice(0, 5).map((c: any) => c.name);
    }
    if (creditsData.crew) {
      const creator = creditsData.crew.find((c: any) => c.job === 'Creator' || c.job === 'Executive Producer');
      if (creator) mapped.director = creator.name;
    }
    if (videosData.results) {
      const trailer = videosData.results.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube')
        ?? videosData.results.find((v: any) => v.site === 'YouTube');
      if (trailer) {
        mapped.trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
      }
    }

    return mapped;
  } catch (error) {
    console.warn('Failed to fetch TV details from TMDB:', error);
    return null;
  }
}

function mapTMDBMovie(m: any): Movie {
  const genresMap: Record<number, string> = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Science Fiction",
    10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western"
  };

  const movieGenres: string[] = [];
  if (m.genre_ids) {
    m.genre_ids.forEach((id: number) => {
      if (genresMap[id]) movieGenres.push(genresMap[id]);
    });
  } else if (m.genres) {
    m.genres.forEach((g: any) => movieGenres.push(g.name));
  }

  return {
    id: String(m.id),
    title: m.title || m.name || 'Untitled Movie',
    originalTitle: m.original_title,
    backdropPath: m.backdrop_path 
      ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` 
      : 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1600&q=80', // Beautiful movie theater
    posterPath: m.poster_path 
      ? `https://image.tmdb.org/t/p/w500${m.poster_path}` 
      : 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?auto=format&fit=crop&w=500&q=80', // Film reel poster
    overview: m.overview || 'No description available.',
    rating: m.vote_average ? Math.round(m.vote_average * 10) / 10 : 0,
    releaseDate: m.release_date || 'Unknown',
    runtime: m.runtime || 120,
    genres: movieGenres.length > 0 ? movieGenres : ["Drama"],
    tagline: m.tagline || "",
  };
}

export function isTVEpisode(fileName: string): boolean {
  return /[Ss]\d{1,2}[Ee]\d{1,2}/.test(fileName);
}

export function parseTVFilename(fileName: string): { title: string; season: number; episode: number } {
  let clean = fileName.replace(/\.[^/.]+$/, "").replace(/[._]/g, " ");
  const seMatch = clean.match(/[Ss](\d{1,2})[Ee](\d{1,2})/);
  const season = seMatch ? parseInt(seMatch[1], 10) : 1;
  const episode = seMatch ? parseInt(seMatch[2], 10) : 1;
  let title = seMatch ? clean.substring(0, clean.search(/[Ss]\d{1,2}[Ee]\d{1,2}/)).trim() : clean;
  title = title.replace(/[-\s]+$/, "").trim();
  return { title, season, episode };
}

/**
 * Filename scanning parser that cleans typical media filenames to match movie records
 * e.g., "Interstellar.2014.1080p.BluRay.x264-SPARKS.mkv" -> Title: "Interstellar", Year: "2014"
 */
export function parseMovieFilename(fileName: string): { title: string; year: string | null } {
  // Remove extension
  let cleanName = fileName.replace(/\.[^/.]+$/, "");

  // Replace dots, underscores, dashes with spaces
  cleanName = cleanName.replace(/[\._\-]/g, " ");

  // Strip everything from SxxExx onward so TV filenames don't break movie queries
  const seIndex = cleanName.search(/[Ss]\d{1,2}[Ee]\d{1,2}/);
  if (seIndex > 0) cleanName = cleanName.substring(0, seIndex).trim();

  // Regular expression to look for typical release years in filename (4-digit, 19xx or 20xx)
  const yearMatch = cleanName.match(/(19\d\d|20\d\d)/);
  let year: string | null = null;
  let title = cleanName;

  if (yearMatch && yearMatch.index !== undefined) {
    year = yearMatch[0];
    // Keep everything before the year as the title
    title = cleanName.substring(0, yearMatch.index).trim();
  }

  // Remove resolution and rip-related tags to make name cleaner if no year is found
  if (!year) {
    const ripTags = [
      /1080p/i, /720p/i, /2160p/i, /4k/i, /bluray/i, /brrip/i, /dvdrip/i, /h264/i, /x264/i,
      /hevc/i, /h265/i, /x265/i, /webrip/i, /web-dl/i, /hdrip/i, /atmos/i, /directors cut/i, /ultimate edition/i
    ];
    ripTags.forEach(tag => {
      title = title.replace(tag, "");
    });
  }

  // Final trim and safety fallback
  title = title.replace(/\s+/g, " ").trim();
  if (title === "") {
    title = fileName.split('.')[0] || fileName;
  }

  return { title, year };
}
