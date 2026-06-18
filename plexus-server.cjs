const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

// ─── CONFIG FILE ──────────────────────────────────────────────────────────────
// Single source of truth for all server configuration.
// Replaces the old plexus-paths.json (library paths are now stored here too).
const CONFIG_FILE = path.join(__dirname, 'plexus-config.json');

const CONFIG_DEFAULTS = {
  libraryPaths: ['C:\\Users\\Public\\Videos'],
  tmdbApiKey: '',
  tvdbApiKey: '',
  trackerFlixHost: 'http://localhost:3000',
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      const merged = { ...CONFIG_DEFAULTS, ...parsed };
      // Back-compat: if old plexus-paths.json exists and config has no paths yet, migrate it
      const legacyPathsFile = path.join(__dirname, 'plexus-paths.json');
      if (
        (!merged.libraryPaths || merged.libraryPaths.length === 0) &&
        fs.existsSync(legacyPathsFile)
      ) {
        try {
          const legacyPaths = JSON.parse(fs.readFileSync(legacyPathsFile, 'utf8'));
          if (Array.isArray(legacyPaths) && legacyPaths.length > 0) {
            merged.libraryPaths = legacyPaths;
            console.log(`[Plexus] Migrated ${legacyPaths.length} path(s) from legacy plexus-paths.json`);
          }
        } catch {}
      }
      console.log(`[Plexus] Config loaded from plexus-config.json`);
      return merged;
    }
  } catch (e) {
    console.warn('[Plexus] Could not read plexus-config.json, using defaults:', e.message);
  }
  return { ...CONFIG_DEFAULTS };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Plexus] Could not save plexus-config.json:', e.message);
  }
}

// Live config object — mutated at runtime via /api/setup and /api/paths
let config = loadConfig();

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
  allowedHeaders: ['Range', 'Content-Type'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ─── SETUP PAGE ───────────────────────────────────────────────────────────────
// Serve the one-time PC configuration UI at GET /setup
app.get('/setup', (req, res) => {
  res.sendFile(path.join(__dirname, 'setup.html'));
});

// GET /api/setup — return current config for the setup page to pre-fill
app.get('/api/setup', (req, res) => {
  res.json({
    libraryPaths: config.libraryPaths,
    tmdbApiKey: config.tmdbApiKey,
    tvdbApiKey: config.tvdbApiKey,
    trackerFlixHost: config.trackerFlixHost,
  });
});

// POST /api/setup — save full server config from the setup page
app.post('/api/setup', (req, res) => {
  const { libraryPaths, tmdbApiKey, tvdbApiKey, trackerFlixHost } = req.body;

  if (Array.isArray(libraryPaths)) config.libraryPaths = libraryPaths;
  if (typeof tmdbApiKey === 'string') config.tmdbApiKey = tmdbApiKey.trim();
  if (typeof tvdbApiKey === 'string') config.tvdbApiKey = tvdbApiKey.trim();
  if (typeof trackerFlixHost === 'string') config.trackerFlixHost = trackerFlixHost.trim();

  saveConfig(config);
  console.log('[Plexus] Config saved via /api/setup');
  res.json({ ok: true, config });
});

// ─── HEALTH ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    platform: process.platform,
    hostname: require('os').hostname()
  });
});

// ─── PATHS (legacy + live update endpoint) ────────────────────────────────────
// Accepts both the old string[] (from APK frontend) and the new
// {path, category}[] objects (from setup.html). Always writes to plexus-config.json.
app.get('/api/paths', (req, res) => {
  // Return current paths so the APK frontend can sync its state
  res.json({ paths: config.libraryPaths || [] });
});

app.post('/api/paths', (req, res) => {
  const { paths } = req.body;
  if (Array.isArray(paths) && paths.length > 0) {
    // Normalise: convert plain strings to objects so config stays consistent
    config.libraryPaths = paths.map(p =>
      typeof p === 'string' ? { path: p, category: 'Movies' } : p
    );
    saveConfig(config);
    console.log(`[Plexus] Library paths updated via /api/paths:`, config.libraryPaths);
  }
  res.json({ ok: true, paths: config.libraryPaths });
});

// ─── HELPER: extract plain path strings from config.libraryPaths ──────────────
// config.libraryPaths can be string[] (legacy) or {path,category}[] (new).
function getScannedPaths() {
  return (config.libraryPaths || []).map(entry =>
    typeof entry === 'string' ? entry : entry.path
  );
}

// ─── MOVIES ───────────────────────────────────────────────────────────────────
// Build a lookup map so each scanned file inherits its parent path's category.
function buildPathCategoryMap() {
  const map = new Map(); // normalised path string → category string
  (config.libraryPaths || []).forEach(entry => {
    const p = typeof entry === 'string' ? entry : entry.path;
    const cat = typeof entry === 'string' ? 'Movies' : (entry.category || 'Movies');
    map.set(p.replace(/\//g, '\\'), cat);
  });
  return map;
}

app.get('/api/movies', (req, res) => {
  const supportedExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];
  const results = [];
  const debugLog = [];

  const serverBase = `${req.protocol}://${req.get('host')}`;
  const pathCategoryMap = buildPathCategoryMap();

  function walkDir(dir, category) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      debugLog.push(`ERROR reading ${dir}: ${err.message}`);
      console.error(`[Plexus] Failed to read directory ${dir}:`, err.message);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath, category);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (supportedExtensions.includes(ext)) {
          try {
            const stats = fs.statSync(fullPath);
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(1) + ' MB';
            results.push({
              id: 'win-' + Buffer.from(fullPath).toString('hex').slice(0, 16),
              title: path.basename(entry.name, ext).replace(/[._\-]/g, ' ').trim(),
              fileName: entry.name,
              filePath: fullPath,
              fileSize: sizeMB,
              fileType: ext.replace('.', '').toUpperCase(),
              addedAt: stats.mtimeMs,
              category: category,
              sourcePath: dir,
              streamUrl: `${serverBase}/api/stream?path=${encodeURIComponent(fullPath)}`
            });
          } catch (fileErr) {
            debugLog.push(`ERROR stat ${entry.name}: ${fileErr.message}`);
            console.warn(`[Plexus] Could not stat file ${entry.name}:`, fileErr.message);
          }
        }
      }
    }
  }

  getScannedPaths().forEach(dir => {
    const normalizedDir = dir.replace(/\//g, '\\');
    const category = pathCategoryMap.get(normalizedDir) || 'Movies';
    debugLog.push(`Scanning (recursive): ${normalizedDir} [${category}]`);

    if (!fs.existsSync(normalizedDir)) {
      debugLog.push(`NOT FOUND: ${normalizedDir}`);
      console.warn(`[Plexus] Path not found or inaccessible: ${normalizedDir}`);
      return;
    }

    walkDir(normalizedDir, category);
    debugLog.push(`Subtree scan complete for ${normalizedDir}`);
  });

  console.log(`[Plexus] Scan complete. Found ${results.length} video files.`);
  res.json({ movies: results, debug: debugLog });
});

// ─── MIME TYPES ───────────────────────────────────────────────────────────────
function getVideoMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.ogg':
    case '.ogv': return 'video/ogg';
    case '.mkv': return 'video/x-matroska';
    case '.avi': return 'video/x-msvideo';
    case '.mov': return 'video/quicktime';
    case '.m4v': return 'video/mp4';
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    default:     return 'application/octet-stream';
  }
}

// ─── STREAM ───────────────────────────────────────────────────────────────────
function handleStream(req, res, sendBody) {
  const videoPath = req.query.path;
  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(404).send('Not found');
  }

  let stat;
  try {
    stat = fs.statSync(videoPath);
  } catch (err) {
    console.error('[Stream] stat failed:', err.message);
    return res.status(500).send('Stat failed');
  }

  const fileSize = stat.size;
  const mimeType = getVideoMimeType(videoPath);
  const range = req.headers.range;

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).send('Invalid range');
      return;
    }
    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end   = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (isNaN(start) || isNaN(end) || start < 0 || start >= fileSize || end >= fileSize || start > end) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).send('Range not satisfiable');
      return;
    }

    const chunksize = (end - start) + 1;
    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': chunksize,
      'Content-Type':   mimeType,
      'Cache-Control':  'no-store',
    });

    if (!sendBody) return res.end();

    const file = fs.createReadStream(videoPath, { start, end });
    file.on('error', (err) => {
      console.error(`[Stream] read error for ${videoPath}:`, err.message);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    req.on('close', () => { file.destroy(); });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type':   mimeType,
      'Accept-Ranges':  'bytes',
      'Cache-Control':  'no-store',
    });

    if (!sendBody) return res.end();

    const file = fs.createReadStream(videoPath);
    file.on('error', (err) => {
      console.error(`[Stream] read error for ${videoPath}:`, err.message);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    req.on('close', () => { file.destroy(); });
    file.pipe(res);
  }
}

const { spawn, execFile } = require('child_process');

const MPV_PATH = path.join(__dirname, 'mpv.exe');
const FFPROBE_PATH = 'C:\\ffmpeg\\bin\\ffprobe.exe';

let mpvProcess = null;

// ─── MEDIA TRACKS ─────────────────────────────────────────────────────────────
app.get('/api/media/tracks', (req, res) => {
  const filePath = req.query.path;

  if (!filePath) {
    return res.status(400).json({ error: 'path is required' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `File not found: ${filePath}` });
  }

  const ffprobeArgs = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    filePath,
  ];

  execFile(FFPROBE_PATH, ffprobeArgs, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
    if (err) {
      console.error('[Plexus] ffprobe error:', err.message);
      return res.status(500).json({ error: 'ffprobe failed', detail: err.message });
    }

    let probe;
    try {
      probe = JSON.parse(stdout);
    } catch (parseErr) {
      return res.status(500).json({ error: 'Failed to parse ffprobe output' });
    }

    const streams = probe.streams || [];

    // IDs are 0-based to match ExoPlayer's track group indices in PlayerActivity.
    const UNSUPPORTED_SUB_CODECS = ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvbsub'];

    const subtitles = streams
      .filter(s => s.codec_type === 'subtitle')
      .map((s, i) => ({
        id: i,   // 0-based — maps directly to ExoPlayer group index
        language: s.tags?.language || 'unknown',
        title: s.tags?.title || s.tags?.language || `Subtitle ${i + 1}`,
        codec: s.codec_name,
        supported: !UNSUPPORTED_SUB_CODECS.includes(s.codec_name), // false = image-based, ExoPlayer can't render
      }));

    const audioTracks = streams
      .filter(s => s.codec_type === 'audio')
      .map((s, i) => ({
        id: i,   // 0-based — maps directly to ExoPlayer group index
        language: s.tags?.language || 'unknown',
        title: s.tags?.title || `${s.codec_name} ${s.channels}ch` || `Audio ${i + 1}`,
        codec: s.codec_name,
        channels: s.channels,
      }));

    // ── Video stream metadata ──────────────────────────────────────────────────
    // Pick the real video stream — largest resolution, skip attached pics/thumbnails
    const videoStream = streams
      .filter(s =>
        s.codec_type === 'video' &&
        s.disposition?.attached_pic !== 1 &&
        s.codec_name !== 'mjpeg' &&
        s.codec_name !== 'png' &&
        s.codec_name !== 'bmp' &&
        (s.width || 0) > 0 &&
        (s.height || 0) > 0
      )
      .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] || null;
    let videoInfo = null;
    if (videoStream) {
      const width = videoStream.width || 0;
      const height = videoStream.height || 0;

      // Resolution label — use the larger dimension so widescreen 4K
      // with non-standard height (e.g. 3840x1604) is still labelled 4K.
      const major = Math.max(width, height);
      let resolution = null;
      if (major >= 3840) resolution = '4K';
      else if (major >= 1920) resolution = '1080p';
      else if (major >= 1280) resolution = '720p';
      else if (major >= 854)  resolution = '480p';
      else if (major > 0)     resolution = `${height}p`;

      // Codec label
      const codecName = videoStream.codec_name || '';
      let codec = codecName.toUpperCase();
      if (codecName === 'hevc') codec = 'HEVC';
      else if (codecName === 'h264' || codecName === 'avc1') codec = 'H.264';
      else if (codecName === 'av1') codec = 'AV1';
      else if (codecName === 'vp9') codec = 'VP9';

      // HDR detection via color transfer / color primaries
      const transfer = videoStream.color_transfer || '';
      const primaries = videoStream.color_primaries || '';
      const profile = (videoStream.profile || '').toLowerCase();
      let hdr = null;
      if (transfer === 'arib-std-b67') hdr = 'HLG';
      else if (transfer === 'smpte2084') {
        if (profile.includes('dolby') || profile.includes('dvhe') || profile.includes('dv')) hdr = 'Dolby Vision';
        else hdr = 'HDR10';
      } else if (primaries === 'bt2020') hdr = 'HDR';

      videoInfo = { width, height, resolution, codec, hdr };
    }

    // ── Audio format label (best track) ───────────────────────────────────────
    const getAudioLabel = (codec, channels) => {
      const c = (codec || '').toLowerCase();
      if (c.includes('truehd') || c.includes('atmos')) return 'Atmos';
      if (c.includes('eac3')) return channels >= 6 ? 'DD+' : 'DD+';
      if (c.includes('ac3')) return 'DD';
      if (c.includes('dts-hd') || c.includes('dts_hd')) return 'DTS-HD';
      if (c === 'dts') return 'DTS';
      if (c.includes('aac')) return 'AAC';
      if (c.includes('flac')) return 'FLAC';
      if (c.includes('mp3')) return 'MP3';
      return codec ? codec.toUpperCase() : null;
    };
    const bestAudio = audioTracks[0];
    const audioLabel = bestAudio ? getAudioLabel(bestAudio.codec, bestAudio.channels) : null;

    console.log(`[Plexus] Tracks for ${path.basename(filePath)}: ${audioTracks.length} audio, ${subtitles.length} subtitle${videoInfo ? `, ${videoInfo.resolution} ${videoInfo.codec}` : ''}`);
    res.json({ subtitles, audioTracks, videoInfo, audioLabel });
  });
});

// ─── MPV PLAYBACK ─────────────────────────────────────────────────────────────
app.post('/api/play/local', (req, res) => {
  const { filePath, startTime, audioTrack, subtitleTrack } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  const isUrl = filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('rtmp://');
  if (!isUrl && !fs.existsSync(filePath)) {
    return res.status(404).json({ error: `File not found: ${filePath}` });
  }

  if (!fs.existsSync(MPV_PATH)) {
    return res.status(500).json({ error: `mpv.exe not found at ${MPV_PATH}` });
  }

  if (mpvProcess) {
    try { mpvProcess.kill(); } catch {}
    mpvProcess = null;
  }

  const args = [
    '--fullscreen',
    '--save-position-on-quit',
    `--start=${startTime || 0}`,
  ];

  if (audioTrack != null) args.push(`--aid=${audioTrack}`);
  if (subtitleTrack != null) args.push(`--sid=${subtitleTrack}`);
  else args.push('--sid=no');

  args.push(filePath);

  console.log(`[Plexus] Launching MPV: ${MPV_PATH} ${args.join(' ')}`);

  try {
    mpvProcess = spawn(MPV_PATH, args, {
      detached: false,
      stdio: 'ignore',
    });

    mpvProcess.on('exit', (code) => {
      console.log(`[Plexus] MPV exited with code ${code}`);
      mpvProcess = null;
    });

    mpvProcess.on('error', (err) => {
      console.error('[Plexus] MPV spawn error:', err.message);
      mpvProcess = null;
    });

    res.json({ ok: true, pid: mpvProcess.pid });
  } catch (err) {
    console.error('[Plexus] Failed to spawn MPV:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/play/stop', (req, res) => {
  if (mpvProcess) {
    try { mpvProcess.kill(); } catch {}
    mpvProcess = null;
    console.log('[Plexus] MPV stopped by client request');
  }
  res.json({ ok: true });
});

// ─── STREAM ROUTES ────────────────────────────────────────────────────────────
app.get('/api/stream', (req, res) => handleStream(req, res, true));
app.head('/api/stream', (req, res) => handleStream(req, res, false));

// ─── LIBRARY CACHE ────────────────────────────────────────────────────────────
const LIBRARY_FILE = path.join(__dirname, 'library-cache.json');

app.get('/api/library', (req, res) => {
  try {
    if (!fs.existsSync(LIBRARY_FILE)) {
      return res.json({});
    }
    const raw = fs.readFileSync(LIBRARY_FILE, 'utf8');
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error('[Plexus] Failed to read library cache:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/library', (req, res) => {
  try {
    const existing = fs.existsSync(LIBRARY_FILE)
      ? JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'))
      : {};
    const merged = { ...existing, ...req.body };
    fs.writeFileSync(LIBRARY_FILE, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`[Plexus] Library cache saved. Keys: ${Object.keys(merged).join(', ')}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Plexus] Failed to write library cache:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/library', (req, res) => {
  try {
    if (fs.existsSync(LIBRARY_FILE)) {
      fs.unlinkSync(LIBRARY_FILE);
      console.log('[Plexus] Library cache deleted.');
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[Plexus] Failed to delete library cache:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── STATIC + SPA FALLBACK ────────────────────────────────────────────────────
// NOTE: /setup is registered above as an explicit route, so it takes priority
// over the SPA catch-all below.
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Plexus Windows Server Service] Active on port ${PORT}`);
  console.log(`[Plexus] Setup page available at: http://localhost:${PORT}/setup`);
});
