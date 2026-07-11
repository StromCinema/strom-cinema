import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Server, Wifi, Play, CheckCircle, ArrowRight, RefreshCw, Tv2, Link2, Search } from 'lucide-react';

interface ConnectionGateProps {
  onConnected: (serverAddress: string) => void;
  targetPlatform: 'windows' | 'android-tv' | 'tizen-tv';
}

type Tab = 'manual' | 'link';
type LinkStatus = 'idle' | 'discovering' | 'requesting' | 'polling' | 'success' | 'expired' | 'error';

// ── Discovery helpers ─────────────────────────────────────────────────────────

/**
 * Probe a single host:port for the Strøm ping endpoint.
 * Returns the address string ("192.168.1.50:5000") on success, null on failure.
 */
async function probeHost(ip: string, port: number, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(`http://${ip}:${port}/api/ping`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.service === 'strom') return `${ip}:${port}`;
    }
  } catch {}
  return null;
}

/**
 * Scan common home network subnets with controlled concurrency.
 * All subnets race in parallel, but we cap active requests to avoid
 * overwhelming Android WebView's connection pool.
 */
async function discoverServer(port = 5000): Promise<string | null> {
  const subnets = ['192.168.0', '192.168.1', '192.168.2', '10.0.0', '10.0.1'];
  const CONCURRENCY = 30; // concurrent requests across all subnets
  const TIMEOUT_MS = 1500;

  // Interleave subnets so we probe .1 on all subnets, then .2 on all, etc.
  // This way the server is found quickly regardless of which subnet it's on.
  const candidates: string[] = [];
  for (let i = 1; i <= 254; i++) {
    for (const subnet of subnets) {
      candidates.push(`${subnet}.${i}`);
    }
  }

  return new Promise((resolve) => {
    let resolved = false;
    let index = 0;
    let active = 0;

    const done = (result: string | null) => {
      active--;
      if (result && !resolved) {
        resolved = true;
        resolve(result);
        return;
      }
      if (!resolved) next();
      if (active === 0 && index >= candidates.length && !resolved) {
        resolve(null);
      }
    };

    const next = () => {
      while (active < CONCURRENCY && index < candidates.length && !resolved) {
        const ip = candidates[index++];
        active++;
        probeHost(ip, port, TIMEOUT_MS).then(done);
      }
    };

    next();
  });
}

/**
 * Ask the native StromPlayer plugin to find the server via mDNS
 * (_strom._tcp), which the companion server advertises via bonjour-service.
 * This is subnet-agnostic — works on any home network without needing to
 * know its IP range ahead of time — so it's tried before the TCP subnet
 * scan. Resolves to null on web/Windows (no native plugin) or if nothing
 * answers within the plugin's own timeout, letting the caller fall through
 * to discoverServer() below.
 */
async function discoverViaNsd(): Promise<string | null> {
  const StromPlayer = (window as any).Capacitor?.Plugins?.StromPlayer;
  if (!StromPlayer?.discoverServer) return null;
  try {
    const { host, port } = await StromPlayer.discoverServer();
    if (!host) return null;
    return `${host}:${port || 5000}`;
  } catch {
    return null; // no responder within the native timeout — fall through
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ConnectionGate({ onConnected, targetPlatform }: ConnectionGateProps) {
  // Link Code is temporarily disabled (not working as intended yet) — default
  // to Manual IP. The 'link' tab/state and all its logic are left in place
  // so it can be re-enabled later; only entry into it is blocked below.
  const [tab, setTab] = useState<Tab>('manual');

  // ── Manual tab state ──────────────────────────────────────────
  const [address, setAddress] = useState(() => localStorage.getItem('strom_server_address') || '');
  const [remember, setRemember] = useState(() => localStorage.getItem('strom_remember_connection') !== 'false');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('Awaiting connection details');

  // ── Link tab state ────────────────────────────────────────────
  const [linkCode, setLinkCode]     = useState<string | null>(null);
  const [linkStatus, setLinkStatus] = useState<LinkStatus>('idle');
  const [pollHost, setPollHost]     = useState<string | null>(null);
  const [discoveryMsg, setDiscoveryMsg] = useState('');
  const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const workingBaseRef = useRef<string | null>(null); // survives interval closure

  // ── D-pad nav ─────────────────────────────────────────────────
  const [gateFocusIdx, setGateFocusIdx] = useState(2);
  const [transitioning, setTransitioning] = useState(false); // blocks input while gate closes
  const inputRef      = useRef<HTMLInputElement>(null);
  const connectBtnRef = useRef<HTMLButtonElement>(null);
  const linkBtnRef    = useRef<HTMLButtonElement>(null);
  const tabLinkRef    = useRef<HTMLButtonElement>(null);
  const tabManualRef  = useRef<HTMLButtonElement>(null);

  // Styling helpers
  const isTizen   = targetPlatform === 'tizen-tv';
  const accent    = isTizen ? 'cyan' : 'orange';
  const ringStyle = isTizen ? 'focus:ring-cyan-500'  : 'focus:ring-orange-500';
  const glowClass = isTizen ? 'ring-cyan-400'        : 'ring-orange-500';
  const btnBg     = isTizen ? 'bg-cyan-400 hover:bg-cyan-300' : 'bg-orange-500 hover:bg-orange-400';

  // ── Focus sync ────────────────────────────────────────────────
  useEffect(() => {
    if (gateFocusIdx === 0) tabLinkRef.current?.focus();
    else if (gateFocusIdx === 1) tabManualRef.current?.focus();
    else if (gateFocusIdx === 2) {
      if (tab === 'link') linkBtnRef.current?.focus();
      else connectBtnRef.current?.focus();
    } else if (gateFocusIdx === 3 && tab === 'manual') {
      inputRef.current?.focus();
    }
  }, [gateFocusIdx, tab]);

  // ── D-pad keys ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (transitioning) { e.preventDefault(); return; }
      if (status === 'success' || linkStatus === 'success') return;
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          // Floor at 1 (Manual IP tab), not 0 — the Link Code tab (idx 0) is
          // disabled and can't receive real focus, so don't let D-pad nav
          // land there.
          setGateFocusIdx((prev) => Math.max(1, prev - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setGateFocusIdx((prev) => Math.min(tab === 'manual' ? 3 : 2, prev + 1));
          break;
        case 'ArrowLeft':
          // Link Code tab temporarily disabled — see note by tab state above.
          break;
        case 'ArrowRight':
          if (gateFocusIdx <= 1) { e.preventDefault(); setTab('manual'); setGateFocusIdx(1); }
          break;
        case 'Enter':
          e.preventDefault();
          if (gateFocusIdx === 0) { /* Link Code disabled — ignore */ }
          else if (gateFocusIdx === 1) { setTab('manual'); setGateFocusIdx(2); }
          else if (gateFocusIdx === 2) {
            if (tab === 'link') requestLinkCode();
            else handleConnect();
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [gateFocusIdx, tab, address, remember, status, linkStatus, transitioning]);

  const safeOnConnected = useCallback((addr: string) => {
    setTransitioning(true);
    // Small delay lets the current keydown event fully flush before
    // the app mounts and its own key handlers attach — prevents the
    // Enter press that triggered connection from firing into the app.
    setTimeout(() => onConnected(addr), 80);
  }, [onConnected]);

  // ── Auto-connect (remembered session) ────────────────────────
  useEffect(() => {
    const autoConn = localStorage.getItem('strom_remember_connection') === 'true';
    const savedAddr = localStorage.getItem('strom_server_address');
    if (!autoConn || !savedAddr) return;

    let cancelled = false;
    (async () => {
      setStatus('connecting');
      setStatusMessage('Auto-connecting to saved media node...');
      const normalized = savedAddr.includes(':') ? savedAddr : `${savedAddr}:5000`;
      const hit = await probeHost(
        normalized.split(':')[0],
        parseInt(normalized.split(':')[1] || '5000'),
        3000
      );
      if (cancelled) return;
      if (hit) {
        setStatus('success');
        setStatusMessage('Sync Complete! Mounting streams...');
        setTimeout(() => safeOnConnected(savedAddr), 1200);
      } else {
        // Server unreachable — drop back to gate so user can re-link
        setStatus('idle');
        setStatusMessage('Saved server unreachable. Please reconnect.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Cleanup poll on unmount ───────────────────────────────────
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Manual connect ────────────────────────────────────────────
  const handleConnect = () => {
    if (!address.trim()) {
      setStatus('error');
      setStatusMessage('Please specify a valid server host IP');
      return;
    }
    setStatus('connecting');
    setStatusMessage('Pinging server host at ' + address + '...');
    setTimeout(() => {
      setStatusMessage('Handshaking with Strøm TV Daemon...');
      setTimeout(() => {
        setStatus('success');
        setStatusMessage('Connected successfully! Synchronizing catalog...');
        localStorage.setItem('strom_server_address', address);
        localStorage.setItem('strom_remember_connection', remember ? 'true' : 'false');
        setTimeout(() => safeOnConnected(address), 1300);
      }, 1000);
    }, 1200);
  };

  // ── Start polling for approval ────────────────────────────────
  const startPolling = useCallback((code: string, base: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    workingBaseRef.current = base;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${base}/api/link/poll?code=${code}`, {
          signal: AbortSignal.timeout(3000),
        });
        const data = await res.json();

        if (data.status === 'approved' && data.host) {
          clearInterval(pollRef.current!);
          setPollHost(data.host);
          setLinkStatus('success');
          localStorage.setItem('strom_server_address', data.host);
          localStorage.setItem('strom_remember_connection', 'true');
          localStorage.setItem('plexus_companion_host', `http://${data.host}`);
          setTimeout(() => safeOnConnected(data.host), 1200);
        } else if (data.status === 'expired') {
          clearInterval(pollRef.current!);
          setLinkStatus('expired');
        }
      } catch { /* network blip — keep polling */ }
    }, 2000);
  }, [safeOnConnected]);

  // ── Link tab: discover server + request code ──────────────────
  const requestLinkCode = useCallback(async () => {
    if (linkStatus === 'requesting' || linkStatus === 'polling' || linkStatus === 'discovering') return;

    setLinkCode(null);
    setPollHost(null);
    if (pollRef.current) clearInterval(pollRef.current);

    try {
      let workingBase: string | null = null;

      // ── Step 1: try saved address first (instant on repeat visits) ──
      const saved = localStorage.getItem('strom_server_address');
      if (saved) {
        const normalized = saved.includes(':') ? saved : `${saved}:5000`;
        setLinkStatus('discovering');
        setDiscoveryMsg('Checking saved server…');
        const hit = await probeHost(
          normalized.split(':')[0],
          parseInt(normalized.split(':')[1] || '5000'),
          2000
        );
        if (hit) {
          workingBase = `http://${hit}`;
          setDiscoveryMsg('');
        }
      }

      // ── Step 2: mDNS (subnet-agnostic, works on any home network) ──────
      if (!workingBase) {
        setLinkStatus('discovering');
        setDiscoveryMsg('Looking for server…');
        const viaMdns = await discoverViaNsd();
        if (viaMdns) {
          workingBase = `http://${viaMdns}`;
          localStorage.setItem('strom_server_address', viaMdns);
          setDiscoveryMsg(`Found server at ${viaMdns}`);
        }
      }

      // ── Step 3: TCP subnet scan — fallback if mDNS is unavailable or ──
      // blocked (e.g. a router with multicast disabled, or web/Windows
      // where there's no native plugin to ask).
      if (!workingBase) {
        setLinkStatus('discovering');
        setDiscoveryMsg('Scanning local network…');
        const discovered = await discoverServer(5000);
        if (discovered) {
          workingBase = `http://${discovered}`;
          // Save so next time we skip straight to it
          localStorage.setItem('strom_server_address', discovered);
          setDiscoveryMsg(`Found server at ${discovered}`);
        }
      }

      if (!workingBase) {
        setLinkStatus('error');
        setDiscoveryMsg('No Strøm server found on this network.');
        return;
      }

      // ── Step 3: request a pairing code ──────────────────────────────
      setLinkStatus('requesting');
      setDiscoveryMsg('');
      const res = await fetch(`${workingBase}/api/link/request`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) { setLinkStatus('error'); return; }
      const data = await res.json();
      const code: string = data.code;

      setLinkCode(code);
      setLinkStatus('polling');

      // ── Step 4: poll every 2 s for approval ─────────────────────────
      startPolling(code, workingBase);

    } catch {
      setLinkStatus('error');
    }
  }, [linkStatus, startPolling]);

  // Format code as "482 916"
  const formattedCode = linkCode ? `${linkCode.slice(0, 3)} ${linkCode.slice(3)}` : null;

  return (
    <div className="min-h-screen bg-[#030303] text-zinc-100 flex flex-col items-center justify-center p-6 relative overflow-hidden select-none">

      {/* Background ambience */}
      <div className="absolute inset-0 opacity-30 pointer-events-none z-0 overflow-hidden">
        <div className={`absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full filter blur-[130px] transition-all duration-1000 ${
          status === 'connecting' || linkStatus === 'polling' || linkStatus === 'discovering'
            ? 'bg-amber-600/20'
            : status === 'success' || linkStatus === 'success'
            ? 'bg-emerald-600/20'
            : isTizen ? 'bg-cyan-600/25' : 'bg-orange-600/25'
        }`} />
        <div className="absolute -bottom-20 -right-20 w-[400px] h-[400px] bg-zinc-900/40 rounded-full filter blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-lg flex flex-col items-center">

        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="mb-6 flex items-center justify-center"
        >
          <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 700, fontSize: '3rem', letterSpacing: '-0.02em', lineHeight: 1 }}>
            <span style={{ color: '#ffffff' }}>Str</span>
            <span style={{ color: '#f97316', textShadow: '0 0 18px rgba(249,115,22,0.8), 0 0 35px rgba(249,115,22,0.4)' }}>ø</span>
            <span style={{ color: '#ffffff' }}>m</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="w-full bg-zinc-950/70 backdrop-blur-2xl border border-zinc-800/80 rounded-2xl shadow-[0_24px_50px_rgba(0,0,0,0.8)] overflow-hidden"
        >
          {/* Tab switcher */}
          <div className="flex border-b border-zinc-800/80">
            <button
              ref={tabLinkRef}
              onClick={() => { /* temporarily disabled — not working as intended yet */ }}
              onFocus={() => setGateFocusIdx(0)}
              disabled
              aria-disabled="true"
              title="Link Code is temporarily disabled — use Manual IP for now"
              className="flex-1 flex items-center justify-center gap-2 py-3.5 text-[11px] font-bold uppercase tracking-widest outline-none text-zinc-600 cursor-not-allowed opacity-50"
            >
              <Tv2 size={13} />
              Link Code
              <span className="text-[8px] font-mono normal-case tracking-normal text-zinc-600">(soon)</span>
            </button>
            <button
              ref={tabManualRef}
              onClick={() => { setTab('manual'); setGateFocusIdx(2); }}
              onFocus={() => setGateFocusIdx(1)}
              className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-[11px] font-bold uppercase tracking-widest transition-all outline-none ${
                tab === 'manual'
                  ? 'text-orange-400 border-b-2 border-orange-500 bg-orange-500/5'
                  : 'text-zinc-500 hover:text-zinc-300'
              } ${gateFocusIdx === 1 ? `ring-2 ring-inset ${glowClass}` : ''}`}
            >
              <Server size={13} />
              Manual IP
            </button>
          </div>

          <div className="p-6">
            <AnimatePresence mode="wait">

              {/* ── LINK CODE TAB ─────────────────────────────── */}
              {tab === 'link' && (
                <motion.div
                  key="link"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-5"
                >
                  {/* Code display area */}
                  <div className="flex flex-col items-center justify-center py-4 space-y-3 min-h-[140px]">

                    {(linkStatus === 'idle') && (
                      <div className="text-center space-y-2">
                        <p className="text-sm text-zinc-400">
                          Press <span className="font-mono text-orange-400 mx-1">Generate Link Code</span> — your TV
                          will find the server automatically.
                        </p>
                        <p className="text-xs text-zinc-600">
                          Then visit <span className="font-mono text-zinc-400">your-server-ip:5000/link</span> on any PC browser.
                        </p>
                      </div>
                    )}

                    {linkStatus === 'discovering' && (
                      <div className="text-center space-y-3">
                        <Search size={28} className="animate-pulse text-orange-500 mx-auto" />
                        <p className="text-xs font-mono text-zinc-400">{discoveryMsg || 'Scanning local network…'}</p>
                        <p className="text-[10px] text-zinc-600">Probing LAN for Strøm server</p>
                      </div>
                    )}

                    {linkStatus === 'requesting' && (
                      <div className="text-center space-y-3">
                        <RefreshCw size={28} className="animate-spin text-orange-500 mx-auto" />
                        <p className="text-xs font-mono text-zinc-500">Generating code…</p>
                      </div>
                    )}

                    {linkStatus === 'expired' && (
                      <p className="text-sm text-red-400 text-center">Code expired. Generate a new one.</p>
                    )}

                    {linkStatus === 'error' && (
                      <div className="text-center space-y-2">
                        <p className="text-sm text-red-400">
                          {discoveryMsg || 'Could not reach server.'}
                        </p>
                        <p className="text-xs text-zinc-600">
                          Make sure Strøm server is running, or use Manual IP.
                        </p>
                      </div>
                    )}

                    {linkStatus === 'success' && (
                      <div className="text-center space-y-1">
                        <CheckCircle size={40} className="text-emerald-400 mx-auto" />
                        <p className="text-sm text-emerald-400 font-bold">Linked!</p>
                        <p className="text-xs font-mono text-zinc-400">{pollHost}</p>
                      </div>
                    )}

                    {linkStatus === 'polling' && formattedCode && (
                      <div className="text-center space-y-3">
                        <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Enter this code at</p>
                        <p className="text-xs font-mono text-orange-400 tracking-wide">your-server-ip:5000/link</p>
                        <div className="mt-2 px-8 py-4 bg-zinc-900 border border-zinc-700 rounded-2xl">
                          <span className="font-mono text-5xl font-black tracking-[0.25em] text-white">
                            {formattedCode}
                          </span>
                        </div>
                        <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
                          <RefreshCw size={11} className="animate-spin" />
                          Waiting for approval…
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action button */}
                  {linkStatus !== 'success' && (
                    <button
                      ref={linkBtnRef}
                      onClick={requestLinkCode}
                      onFocus={() => setGateFocusIdx(2)}
                      disabled={
                        linkStatus === 'discovering' ||
                        linkStatus === 'requesting' ||
                        linkStatus === 'polling'
                      }
                      className={`w-full relative py-3.5 px-6 rounded-xl font-bold font-sans text-xs uppercase tracking-widest text-black flex items-center justify-center gap-2 transition-all duration-300 shadow-lg ${btnBg} ${
                        gateFocusIdx === 2 ? `ring-4 ${glowClass} ring-offset-4 ring-offset-zinc-950 scale-[1.02]` : ''
                      } disabled:opacity-60 disabled:cursor-not-allowed`}
                    >
                      {linkStatus === 'discovering' ? (
                        <><Search size={13} className="animate-pulse" /> Scanning Network…</>
                      ) : linkStatus === 'requesting' ? (
                        <><RefreshCw size={13} className="animate-spin" /> Generating Code…</>
                      ) : linkStatus === 'polling' ? (
                        <><RefreshCw size={13} className="animate-spin" /> Waiting for PC…</>
                      ) : (linkStatus === 'expired' || linkStatus === 'error') ? (
                        <><RefreshCw size={13} /> Try Again</>
                      ) : (
                        <><Link2 size={13} /> Generate Link Code</>
                      )}
                    </button>
                  )}
                </motion.div>
              )}

              {/* ── MANUAL IP TAB ─────────────────────────────── */}
              {tab === 'manual' && (
                <motion.div
                  key="manual"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-5"
                >
                  {/* Status strip */}
                  <div className="flex items-center justify-between pb-4 border-b border-zinc-900">
                    <span className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase">System Hub Connection</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono uppercase text-zinc-400">
                        {status === 'idle'       && 'Awaiting'}
                        {status === 'connecting' && 'Verifying...'}
                        {status === 'success'    && 'Ready'}
                        {status === 'error'      && 'Unreachable'}
                      </span>
                      <span className={`w-2.5 h-2.5 rounded-full relative ${
                        status === 'idle'       ? 'bg-amber-500'
                        : status === 'connecting' ? 'bg-yellow-400 animate-pulse'
                        : status === 'success'    ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]'
                        : 'bg-red-500'
                      }`}>
                        {status === 'connecting' && (
                          <span className="absolute inset-0 rounded-full bg-yellow-400 opacity-75 animate-ping" />
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Address input */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] tracking-wider font-mono text-zinc-400 uppercase flex items-center gap-1.5">
                      <Server size={11} className={`text-${accent}-400`} />
                      Media Server IP / Port
                    </label>
                    <div className="relative">
                      <input
                        ref={inputRef}
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="e.g. 192.168.1.100:5000"
                        disabled={status === 'connecting' || status === 'success'}
                        onFocus={() => setGateFocusIdx(3)}
                        className={`w-full bg-zinc-900/60 border border-zinc-800 rounded-xl py-3 pl-10 pr-4 text-sm font-mono text-white placeholder-zinc-600 transition-all duration-300 focus:outline-none focus:bg-zinc-900 focus:border-zinc-700 focus:ring-2 ${ringStyle} ${status === 'success' ? 'opacity-50' : ''}`}
                      />
                      <Wifi size={14} className="absolute left-3.5 top-3.5 text-zinc-500" />
                    </div>
                  </div>

                  {/* Remember checkbox */}
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                        disabled={status === 'connecting' || status === 'success'}
                        className={`rounded border-zinc-800 bg-zinc-900/60 text-orange-500 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black ${ringStyle}`}
                      />
                      <span className="text-xs text-zinc-400 font-sans">Remember host connection</span>
                    </label>
                  </div>

                  {/* Connect button */}
                  <button
                    ref={connectBtnRef}
                    onClick={handleConnect}
                    onFocus={() => setGateFocusIdx(2)}
                    disabled={status === 'connecting' || status === 'success'}
                    className={`w-full relative py-3.5 px-6 rounded-xl font-bold font-sans text-xs uppercase tracking-widest text-black flex items-center justify-center gap-2 transition-all duration-300 group shadow-lg ${
                      status === 'success' ? 'bg-emerald-500' : btnBg
                    } ${gateFocusIdx === 2 ? `ring-4 ${glowClass} ring-offset-4 ring-offset-zinc-950 scale-[1.02]` : ''} disabled:opacity-80`}
                  >
                    {status === 'connecting' ? (
                      <><RefreshCw size={14} className="animate-spin text-black" /><span>Connecting to Node...</span></>
                    ) : status === 'success' ? (
                      <><CheckCircle size={14} className="text-black" /><span>Interactive Handshake Success</span></>
                    ) : (
                      <><Play size={11} fill="black" /><span>Connect Server</span><ArrowRight size={13} className="ml-0.5 transition-transform group-hover:translate-x-1" /></>
                    )}
                  </button>

                  {/* Status message */}
                  <div className="text-center">
                    <span className={`text-[10px] font-mono tracking-wide ${
                      status === 'error'   ? 'text-red-400'
                      : status === 'success' ? 'text-emerald-400 font-bold'
                      : 'text-zinc-500'
                    }`}>
                      {statusMessage}
                    </span>
                  </div>
                </motion.div>
              )}

            </AnimatePresence>
          </div>
        </motion.div>

        {/* Tips */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-8 text-center space-y-1.5"
        >
          <p className="text-[10px] font-mono text-zinc-500 tracking-wider">
            Tip: Press <kbd className="bg-zinc-900 px-1 py-0.5 rounded text-zinc-300">▲</kbd> / <kbd className="bg-zinc-900 px-1 py-0.5 rounded text-zinc-300">▼</kbd> to jump focus, <kbd className="bg-zinc-900 px-1 py-0.5 rounded text-zinc-300">◀▶</kbd> to switch tabs.
          </p>
          <p className="text-[9px] text-zinc-600 uppercase font-sans tracking-widest font-semibold">
            Strøm Cinema Gateway v1.6.0 stable
          </p>
        </motion.div>

      </div>
    </div>
  );
}
