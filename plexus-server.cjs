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

// ─── PING (LAN discovery — TV subnet scanner hits this to identify the server) ─
app.get('/api/ping', (req, res) => {
  res.json({ service: 'strom', port: PORT });
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
              id: 'win-' + require('crypto').createHash('sha1').update(fullPath).digest('hex').slice(0, 24),
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
const net = require('net');

const MPV_PATH = path.join(__dirname, 'mpv.exe');
const FFPROBE_PATH = 'C:\\ffmpeg\\bin\\ffprobe.exe';
const MPV_IPC_PATH = '\\\\.\\pipe\\strom-mpv';

let mpvProcess = null;

// ─── MPV IPC — position tracking for Resume ────────────────────────────────
// mpv runs detached on the server. The only way the frontend can know "where
// did the user leave off" is if we ask mpv ourselves over its JSON IPC pipe
// and hand that off via /api/play/status. mpvState is intentionally global —
// only one mpv instance ever runs at a time (see kill-previous logic below).
let mpvIpc = null;
let mpvIpcBuffer = '';
let mpvPollTimer = null;
let mpvState = {
  filePath: null,
  movieId: null,
  position: 0,
  duration: 0,
  playing: false,
  endedAt: null,
};

function connectMpvIpc(retriesLeft = 20) {
  const sock = net.connect(MPV_IPC_PATH);

  sock.on('connect', () => {
    mpvIpc = sock;
    mpvIpcBuffer = '';
    if (mpvPollTimer) clearInterval(mpvPollTimer);
    mpvPollTimer = setInterval(() => {
      if (!mpvIpc) return;
      try {
        mpvIpc.write(JSON.stringify({ command: ['get_property', 'time-pos'], request_id: 1 }) + '\n');
        mpvIpc.write(JSON.stringify({ command: ['get_property', 'duration'], request_id: 2 }) + '\n');
      } catch {}
    }, 2000);
  });

  sock.on('data', (chunk) => {
    mpvIpcBuffer += chunk.toString();
    const lines = mpvIpcBuffer.split('\n');
    mpvIpcBuffer = lines.pop(); // keep trailing partial line for next chunk
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.request_id === 1 && typeof msg.data === 'number') mpvState.position = msg.data;
        if (msg.request_id === 2 && typeof msg.data === 'number') mpvState.duration = msg.data;
      } catch {}
    }
  });

  sock.on('error', () => {
    // Pipe isn't up yet right after spawn — mpv needs a moment to create it.
    if (retriesLeft > 0) setTimeout(() => connectMpvIpc(retriesLeft - 1), 250);
  });

  sock.on('close', () => {
    mpvIpc = null;
    if (mpvPollTimer) { clearInterval(mpvPollTimer); mpvPollTimer = null; }
  });
}

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
  const { filePath, startTime, audioTrack, subtitleTrack, movieId } = req.body;

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
    `--input-ipc-server=${MPV_IPC_PATH}`,
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

    mpvState = {
      filePath,
      movieId: movieId || null,
      position: startTime || 0,
      duration: 0,
      playing: true,
      endedAt: null,
    };
    connectMpvIpc();

    mpvProcess.on('exit', (code) => {
      console.log(`[Plexus] MPV exited with code ${code}`);
      mpvProcess = null;
      mpvState.playing = false;
      mpvState.endedAt = Date.now();
      if (mpvIpc) { try { mpvIpc.destroy(); } catch {} mpvIpc = null; }
      if (mpvPollTimer) { clearInterval(mpvPollTimer); mpvPollTimer = null; }
    });

    mpvProcess.on('error', (err) => {
      console.error('[Plexus] MPV spawn error:', err.message);
      mpvProcess = null;
      mpvState.playing = false;
      mpvState.endedAt = Date.now();
    });

    res.json({ ok: true, pid: mpvProcess.pid });
  } catch (err) {
    console.error('[Plexus] Failed to spawn MPV:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Polled by the frontend to detect when mpv closes and what position it was
// at, so a PlaybackSession can be saved/updated for Resume.
app.get('/api/play/status', (req, res) => {
  res.json(mpvState);
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

// ─── TV LINK PAIRING ──────────────────────────────────────────────────────────
// Plex-style code pairing: TV requests a code, user visits /link on PC browser,
// types the code, TV gets the server address back automatically.
//
// Flow:
//   1. TV  → POST /api/link/request        → { code: "482916" }
//   2. TV  → GET  /api/link/poll?code=…    → { status: "pending" | "approved", host }
//   3. PC  → GET  /link                    → HTML pairing page
//   4. PC  → POST /api/link/approve        → { code, approved: true }

const os = require('os');

// In-memory store: code → { approved, createdAt }
const linkCodes = new Map();
const LINK_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Helper: get the primary local IPv4 address of this machine
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  let fallback = '127.0.0.1';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Prefer real LAN ranges over VPN / virtual adapter addresses
        if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
          return iface.address;
        }
        // Keep first non-internal address as fallback in case no LAN range matches
        if (fallback === '127.0.0.1') fallback = iface.address;
      }
    }
  }
  return fallback;
}

// Cleanup expired codes every minute
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of linkCodes.entries()) {
    if (now - entry.createdAt > LINK_CODE_TTL_MS) {
      linkCodes.delete(code);
    }
  }
}, 60_000);

// POST /api/link/request — TV calls this to get a fresh pairing code
app.post('/api/link/request', (req, res) => {
  // Generate a 6-digit numeric code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  linkCodes.set(code, { approved: false, createdAt: Date.now() });
  console.log(`[Plexus Link] New pairing code issued: ${code}`);
  res.json({ code, expiresInSeconds: 300 });
});

// GET /api/link/poll?code=XXXXXX — TV polls this until approved
app.get('/api/link/poll', (req, res) => {
  const { code } = req.query;
  if (!code || !linkCodes.has(code)) {
    return res.status(404).json({ status: 'expired' });
  }
  const entry = linkCodes.get(code);
  if (Date.now() - entry.createdAt > LINK_CODE_TTL_MS) {
    linkCodes.delete(code);
    return res.status(410).json({ status: 'expired' });
  }
  if (entry.approved) {
    linkCodes.delete(code); // single-use
    const host = `${getLocalIP()}:${PORT}`;
    console.log(`[Plexus Link] Code ${code} approved — sending host ${host}`);
    return res.json({ status: 'approved', host });
  }
  res.json({ status: 'pending' });
});

// POST /api/link/approve — PC browser submits the code
app.post('/api/link/approve', (req, res) => {
  const { code } = req.body;
  if (!code || !linkCodes.has(code)) {
    return res.status(404).json({ ok: false, error: 'Code not found or expired' });
  }
  const entry = linkCodes.get(code);
  if (Date.now() - entry.createdAt > LINK_CODE_TTL_MS) {
    linkCodes.delete(code);
    return res.status(410).json({ ok: false, error: 'Code expired' });
  }
  entry.approved = true;
  console.log(`[Plexus Link] Code ${code} approved via browser`);
  res.json({ ok: true });
});

// GET /link — PC browser pairing page
app.get('/link', (req, res) => {
  const localIP = getLocalIP();
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Strøm — Link TV</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background: #030303;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: #0f0f0f;
      border: 1px solid #27272a;
      border-radius: 20px;
      padding: 36px 32px;
      box-shadow: 0 24px 60px rgba(0,0,0,0.8);
    }
    .logo {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 2.2rem;
      font-weight: 700;
      text-align: center;
      margin-bottom: 28px;
      letter-spacing: -0.02em;
    }
    .logo .o { color: #f97316; text-shadow: 0 0 18px rgba(249,115,22,0.8); }
    h1 { font-size: 1rem; font-weight: 700; color: #e4e4e7; margin-bottom: 6px; }
    p  { font-size: 0.78rem; color: #71717a; margin-bottom: 24px; line-height: 1.5; }
    label {
      display: block;
      font-size: 0.68rem;
      font-family: monospace;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #71717a;
      margin-bottom: 6px;
    }
    input[type=text] {
      width: 100%;
      background: #18181b;
      border: 1px solid #3f3f46;
      border-radius: 12px;
      padding: 12px 16px;
      font-size: 1.6rem;
      font-family: monospace;
      letter-spacing: 0.3em;
      color: #fff;
      outline: none;
      text-align: center;
      transition: border-color 0.2s, box-shadow 0.2s;
      margin-bottom: 16px;
    }
    input[type=text]:focus {
      border-color: #f97316;
      box-shadow: 0 0 0 3px rgba(249,115,22,0.2);
    }
    button {
      width: 100%;
      background: #f97316;
      color: #000;
      border: none;
      border-radius: 12px;
      padding: 13px;
      font-size: 0.82rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
    }
    button:hover  { background: #fb923c; }
    button:active { transform: scale(0.98); }
    button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .status {
      margin-top: 18px;
      text-align: center;
      font-size: 0.75rem;
      font-family: monospace;
      min-height: 20px;
      transition: color 0.3s;
    }
    .status.ok      { color: #34d399; }
    .status.err     { color: #f87171; }
    .status.pending { color: #a1a1aa; }
    .divider {
      border: none;
      border-top: 1px solid #27272a;
      margin: 24px 0;
    }
    .hint {
      font-size: 0.7rem;
      color: #52525b;
      text-align: center;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Str<span class="o">ø</span>m</div>
    <h1>Link your TV</h1>
    <p>Enter the 6-digit code shown on your TV screen to connect it to this server.</p>

    <label>Pairing Code</label>
    <input
      id="code-input"
      type="text"
      maxlength="6"
      placeholder="000000"
      autocomplete="off"
      inputmode="numeric"
      autofocus
    />
    <button id="approve-btn" onclick="approve()">Link TV</button>
    <div id="status" class="status pending"></div>

    <hr class="divider" />
    <div class="hint">Server running at ${localIP}:${PORT}</div>
  </div>

  <script>
    async function approve() {
      const code = document.getElementById('code-input').value.trim();
      const btn  = document.getElementById('approve-btn');
      const statusEl = document.getElementById('status');

      if (code.length !== 6) {
        statusEl.className = 'status err';
        statusEl.textContent = 'Please enter the full 6-digit code.';
        return;
      }

      btn.disabled = true;
      statusEl.className = 'status pending';
      statusEl.textContent = 'Linking…';

      try {
        const res  = await fetch('/api/link/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (data.ok) {
          statusEl.className = 'status ok';
          statusEl.textContent = '✓ TV linked successfully! Your TV will connect momentarily.';
        } else {
          statusEl.className = 'status err';
          statusEl.textContent = data.error || 'Code not found or expired. Try again.';
          btn.disabled = false;
        }
      } catch {
        statusEl.className = 'status err';
        statusEl.textContent = 'Could not reach server. Are you on the same network?';
        btn.disabled = false;
      }
    }

    // Allow Enter key to submit
    document.getElementById('code-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') approve();
    });

    // Auto-format: digits only
    document.getElementById('code-input').addEventListener('input', e => {
      e.target.value = e.target.value.replace(/\\D/g, '').slice(0, 6);
    });
  </script>
</body>
</html>`);
});

// ─── STATIC + SPA FALLBACK ────────────────────────────────────────────────────
// NOTE: /setup is registered above as an explicit route, so it takes priority
// over the SPA catch-all below.
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ─── mDNS ADVERTISEMENT (LAN auto-discovery) ─────────────────────────────────
// Advertises this server as `_strom._tcp.local` on the LAN so the Android TV
// app can find it via NsdManager without knowing the subnet/IP range ahead of
// time. This is the primary discovery path — the TCP subnet scan in
// ConnectionGate.tsx only runs as a fallback if mDNS is unavailable/blocked
// (e.g. a router with multicast disabled).
const { Bonjour } = require('bonjour-service');
const bonjour = new Bonjour();

const mdnsService = bonjour.publish({
  name: `Strøm-${os.hostname()}`,
  type: 'strom', // resolves on the network as _strom._tcp.local
  port: PORT,
});
console.log(`[Plexus] mDNS advertising as "Strøm-${os.hostname()}" (_strom._tcp, port ${PORT})`);

// Unpublish cleanly on shutdown so stale entries don't linger in other
// devices' mDNS caches after this process exits.
function shutdownMdns() {
  bonjour.unpublishAll(() => {
    bonjour.destroy();
    process.exit(0);
  });
}
process.on('SIGINT', shutdownMdns);
process.on('SIGTERM', shutdownMdns);

// ─── STARTUP BANNER ───────────────────────────────────────────────────────────
// Prints the LAN address in large "digital clock" style digits so it's easy
// to read from across the room when typing it into a TV's Manual IP field —
// a plain one-line log is easy to miss among all the other console output.
const SEVEN_SEGMENT = {
  '0': [' _ ', '| |', '|_|'],
  '1': ['   ', '  |', '  |'],
  '2': [' _ ', ' _|', '|_ '],
  '3': [' _ ', ' _|', ' _|'],
  '4': ['   ', '|_|', '  |'],
  '5': [' _ ', '|_ ', ' _|'],
  '6': [' _ ', '|_ ', '|_|'],
  '7': [' _ ', '  |', '  |'],
  '8': [' _ ', '|_|', '|_|'],
  '9': [' _ ', '|_|', ' _|'],
  '.': ['   ', '   ', ' o '],
  ':': ['   ', ' o ', ' o '],
};

function renderBigText(text) {
  const rows = ['', '', ''];
  for (const ch of text) {
    const glyph = SEVEN_SEGMENT[ch] || ['   ', '   ', '   '];
    for (let r = 0; r < 3; r++) rows[r] += glyph[r] + ' ';
  }
  return rows;
}

function printServerBanner() {
  const address = `${getLocalIP()}:${PORT}`;
  const bigRows = renderBigText(address);
  const footer = "Enter this on your TV's Manual IP tab";
  const contentWidth = Math.max('SERVER ADDRESS'.length, footer.length, ...bigRows.map((r) => r.length)) + 2;

  const line = '='.repeat(contentWidth + 2);
  console.log('');
  console.log(`+${line}+`);
  console.log(`|  ${'SERVER ADDRESS'.padEnd(contentWidth)}|`);
  console.log(`|${' '.repeat(contentWidth + 2)}|`);
  for (const row of bigRows) {
    console.log(`|  ${row.padEnd(contentWidth)}|`);
  }
  console.log(`|${' '.repeat(contentWidth + 2)}|`);
  console.log(`|  ${footer.padEnd(contentWidth)}|`);
  console.log(`+${line}+`);
  console.log('');
}

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Plexus Windows Server Service] Active on port ${PORT}`);
  console.log(`[Plexus] Setup page available at: http://localhost:${PORT}/setup`);
  printServerBanner();
});
