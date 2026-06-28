import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Image, LogOut, Zap, CheckCircle2, XCircle, Loader2, Wifi, RefreshCw } from 'lucide-react';
import { TMDBConfig } from '../types';

interface SettingsPanelProps {
  tmdbConfig: TMDBConfig;
  onUpdateTMDBConfig: (c: Partial<TMDBConfig>) => void;

  trackerFlixHost: string;
  onUpdateTrackerFlixHost: (host: string) => void;
  trackerFlixStatus: 'untested' | 'connecting' | 'connected' | 'failed';
  onTestTrackerFlixConnection: () => void;

  /** Companion server host — passed from App as companionHost */
  companionHost?: string;
  /** Triggers a full rescan + metadata enrich + state update in App */
  onTriggerCompanionScan?: () => Promise<void>;

  onDisconnect?: () => void;
}

// Focusable item IDs in D-pad order (top → bottom)
const NAV_ITEMS = [
  'trackerflix-host-input',
  'trackerflix-connect',
  'backdrop-toggle',
  'sync-library-btn',
  'disconnect-btn',
] as const;

type NavItem = typeof NAV_ITEMS[number];

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

export default function SettingsPanel({
  tmdbConfig,
  onUpdateTMDBConfig,
  trackerFlixHost,
  onUpdateTrackerFlixHost,
  trackerFlixStatus,
  onTestTrackerFlixConnection,
  companionHost,
  onTriggerCompanionScan,
  onDisconnect,
}: SettingsPanelProps) {
  const [focusIdx, setFocusIdx] = useState(0);
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const [hostDraft, setHostDraft] = useState(trackerFlixHost);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncResult, setSyncResult] = useState<{ count: number } | null>(null);

  const focusItem = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(NAV_ITEMS.length - 1, idx));
    setFocusIdx(clamped);
    itemRefs.current[NAV_ITEMS[clamped]]?.focus();
  }, []);

  // ── D-pad keyboard navigation ───────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          focusItem(focusIdx + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          focusItem(focusIdx - 1);
          break;
        case 'ArrowRight':
          break;
        case 'ArrowLeft':
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          itemRefs.current[NAV_ITEMS[focusIdx]]?.click();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusIdx, focusItem]);

  // ── Sync Library handler ─────────────────────────────────────
  const handleSyncLibrary = useCallback(async () => {
    if (syncStatus === 'syncing') return;
    if (!onTriggerCompanionScan) {
      setSyncStatus('error');
      setTimeout(() => setSyncStatus('idle'), 4000);
      return;
    }
    setSyncStatus('syncing');
    setSyncResult(null);
    try {
      await onTriggerCompanionScan();
      // After scan, ask the server how many files it found for the count display
      if (companionHost) {
        try {
          const res = await fetch(`${companionHost.replace(/\/$/, '')}/api/movies`, {
            signal: AbortSignal.timeout(10_000),
          });
          if (res.ok) {
            const data = await res.json();
            const count = Array.isArray(data) ? data.length : (data?.movies?.length ?? 0);
            setSyncResult({ count });
          }
        } catch {
          // count is optional — scan already succeeded
        }
      }
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 4000);
    } catch {
      setSyncStatus('error');
      setTimeout(() => setSyncStatus('idle'), 4000);
    }
  }, [syncStatus, onTriggerCompanionScan, companionHost]);

  const showBackdrop = tmdbConfig.showBackdrop ?? true;

  // Helper: ref setter
  function setRef(id: string) {
    return (el: HTMLElement | null) => { itemRefs.current[id] = el; };
  }

  // Helper: focused class
  function isFocused(id: NavItem) {
    return NAV_ITEMS[focusIdx] === id;
  }

  return (
    <div
      id="apk-settings-panel"
      className="space-y-6 py-6 font-sans"
      onFocus={(e) => {
        const id = e.target.id as NavItem;
        const idx = NAV_ITEMS.indexOf(id);
        if (idx !== -1) setFocusIdx(idx);
      }}
    >

      {/* ── TRACKERFLIX HOST ─────────────────────────────────── */}
      <section className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
          <div className="bg-orange-500/10 border border-orange-500/30 p-2.5 rounded-xl text-orange-500">
            <Zap size={18} />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-zinc-100">TrackerFlix Host</h2>
            <p className="text-xs text-zinc-500">Local URL where your TrackerFlix instance is running. Leave as default if running on this machine.</p>
          </div>
          {/* Status badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${
            trackerFlixStatus === 'connected'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : trackerFlixStatus === 'connecting'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              : trackerFlixStatus === 'failed'
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : 'bg-zinc-800/60 border-zinc-700 text-zinc-500'
          }`}>
            {trackerFlixStatus === 'connected' && <CheckCircle2 size={12} />}
            {trackerFlixStatus === 'connecting' && <Loader2 size={12} className="animate-spin" />}
            {trackerFlixStatus === 'failed' && <XCircle size={12} />}
            {trackerFlixStatus === 'untested' && <Wifi size={12} />}
            <span>{trackerFlixStatus === 'untested' ? 'Not tested' : trackerFlixStatus}</span>
          </div>
        </div>

        {/* URL input */}
        <div className="space-y-1.5">
          <label className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            TrackerFlix Base URL
          </label>
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border bg-zinc-900 transition-all ${
            isFocused('trackerflix-host-input')
              ? 'border-orange-500 ring-2 ring-orange-500/30'
              : 'border-zinc-800'
          }`}>
            <span className="font-mono text-xs text-zinc-500 select-none flex-shrink-0">HOST:</span>
            <input
              id="trackerflix-host-input"
              ref={(el) => { itemRefs.current['trackerflix-host-input'] = el; }}
              type="text"
              value={hostDraft}
              onChange={(e) => setHostDraft(e.target.value)}
              onBlur={() => {
                const clean = hostDraft.trim().replace(/\/$/, '');
                setHostDraft(clean);
                onUpdateTrackerFlixHost(clean);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                  onUpdateTrackerFlixHost(hostDraft.trim().replace(/\/$/, ''));
                }
              }}
              className="flex-1 bg-transparent font-mono text-sm text-zinc-100 placeholder-zinc-600 outline-none caret-orange-500"
              placeholder="http://localhost:3000"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
        </div>

        {/* Connect button */}
        <button
          id="trackerflix-connect"
          ref={setRef('trackerflix-connect')}
          type="button"
          disabled={trackerFlixStatus === 'connecting'}
          onClick={() => {
            const clean = hostDraft.trim().replace(/\/$/, '');
            setHostDraft(clean);
            onUpdateTrackerFlixHost(clean);
            onTestTrackerFlixConnection();
          }}
          className={`w-full flex items-center justify-center gap-2.5 py-3 px-6 rounded-xl border font-bold text-sm transition-all duration-200 outline-none focus:outline-none ${
            isFocused('trackerflix-connect')
              ? 'border-orange-500 ring-2 ring-orange-500/30 bg-orange-500/15 text-orange-300'
              : trackerFlixStatus === 'connected'
              ? 'border-emerald-600/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15'
              : trackerFlixStatus === 'failed'
              ? 'border-red-600/50 bg-red-500/10 text-red-400 hover:bg-red-500/15'
              : 'border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {trackerFlixStatus === 'connecting' ? (
            <><Loader2 size={15} className="animate-spin" /> Connecting…</>
          ) : trackerFlixStatus === 'connected' ? (
            <><CheckCircle2 size={15} /> Reconnect</>
          ) : trackerFlixStatus === 'failed' ? (
            <><XCircle size={15} /> Retry Connection</>
          ) : (
            <><Zap size={15} /> Connect</>
          )}
        </button>
      </section>

      {/* ── BACKDROP TOGGLE ──────────────────────────────────── */}
      <section className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
          <div className="bg-orange-500/10 border border-orange-500/30 p-2.5 rounded-xl text-orange-500">
            <Image size={18} />
          </div>
          <div>
            <h2 className="text-base font-bold text-zinc-100">Backdrop</h2>
            <p className="text-xs text-zinc-500">Show movie artwork behind the interface.</p>
          </div>
        </div>

        <button
          id="backdrop-toggle"
          ref={setRef('backdrop-toggle')}
          type="button"
          onClick={() => onUpdateTMDBConfig({ showBackdrop: !showBackdrop })}
          className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all outline-none focus:outline-none ${
            isFocused('backdrop-toggle')
              ? 'border-orange-500 ring-2 ring-orange-500/30 bg-zinc-900'
              : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
          }`}
        >
          <div className="flex flex-col gap-0.5 text-left">
            <span className="text-sm font-semibold text-zinc-100">Dynamic Backdrop</span>
            <span className="text-xs text-zinc-500">
              {showBackdrop ? 'Backdrop images enabled' : 'Backdrop images disabled'}
            </span>
          </div>

          {/* Toggle pill */}
          <div
            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 transition-colors duration-200 ${
              showBackdrop ? 'bg-orange-500 border-orange-500' : 'bg-zinc-700 border-zinc-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                showBackdrop ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </div>
        </button>
      </section>

      {/* ── SYNC LIBRARY ─────────────────────────────────────── */}
      <section className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
          <div className="bg-orange-500/10 border border-orange-500/30 p-2.5 rounded-xl text-orange-500">
            <RefreshCw size={18} />
          </div>
          <div>
            <h2 className="text-base font-bold text-zinc-100">Library</h2>
            <p className="text-xs text-zinc-500">
              Rescans all library paths on the server. Use this after adding new files without restarting.
            </p>
          </div>
        </div>

        <button
          id="sync-library-btn"
          ref={setRef('sync-library-btn')}
          type="button"
          disabled={syncStatus === 'syncing'}
          onClick={handleSyncLibrary}
          className={`w-full flex items-center justify-center gap-2.5 py-3 px-6 rounded-xl border font-bold text-sm transition-all duration-200 outline-none focus:outline-none ${
            isFocused('sync-library-btn')
              ? 'border-orange-500 ring-2 ring-orange-500/30 bg-orange-500/15 text-orange-300'
              : syncStatus === 'success'
              ? 'border-emerald-600/50 bg-emerald-500/10 text-emerald-400'
              : syncStatus === 'error'
              ? 'border-red-600/50 bg-red-500/10 text-red-400'
              : 'border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {syncStatus === 'syncing' ? (
            <><Loader2 size={15} className="animate-spin" /> Scanning library…</>
          ) : syncStatus === 'success' ? (
            <><CheckCircle2 size={15} /> {syncResult ? `${syncResult.count} files found` : 'Sync complete'}</>
          ) : syncStatus === 'error' ? (
            <><XCircle size={15} /> Sync failed — retry?</>
          ) : (
            <><RefreshCw size={15} /> Sync Library</>
          )}
        </button>
      </section>

      {/* ── DISCONNECT ───────────────────────────────────────── */}
      {onDisconnect && (
        <section className="bg-zinc-950 border border-red-900/40 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
            <div className="bg-red-500/10 border border-red-500/30 p-2.5 rounded-xl text-red-500">
              <LogOut size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-100">Server Connection</h2>
              <p className="text-xs text-zinc-500">Disconnect and return to the connection screen.</p>
            </div>
          </div>
          <button
            id="disconnect-btn"
            ref={setRef('disconnect-btn')}
            type="button"
            onClick={onDisconnect}
            className={`w-full flex items-center justify-center gap-2 py-3 px-6 bg-red-500/10 border text-red-400 font-bold text-sm rounded-xl transition-all duration-200 outline-none focus:outline-none ${
              isFocused('disconnect-btn')
                ? 'border-red-500 ring-2 ring-red-500/30 bg-red-500/20 text-red-300'
                : 'border-red-500/40 hover:border-red-500/70 hover:bg-red-500/20 hover:text-red-300'
            }`}
          >
            <LogOut size={15} />
            Disconnect from Server
          </button>
        </section>
      )}

    </div>
  );
}
