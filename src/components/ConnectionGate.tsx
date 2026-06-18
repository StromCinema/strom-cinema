import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Server, Wifi, Play, CheckCircle, ArrowRight, RefreshCw, Key } from 'lucide-react';

interface ConnectionGateProps {
  onConnected: (serverAddress: string) => void;
  targetPlatform: 'windows' | 'android-tv' | 'tizen-tv';
}

export default function ConnectionGate({ onConnected, targetPlatform }: ConnectionGateProps) {
  const [address, setAddress] = useState(() => {
    return localStorage.getItem('strom_server_address') || '';
  });
  const [remember, setRemember] = useState(() => {
    return localStorage.getItem('strom_remember_connection') !== 'false';
  });
  
  const [status, setStatus] = useState<'idle' | 'connecting' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('Awaiting connection details');
  
  // D-pad navigation state for the Gate (uniquely managed here)
  const [gateFocusIdx, setGateFocusIdx] = useState<number>(2); // Default focus on the CTA button
  
  const inputRef = useRef<HTMLInputElement>(null);
  const connectBtnRef = useRef<HTMLButtonElement>(null);
  const rememberRef = useRef<HTMLInputElement>(null);

  // Focus synchronization for TV mode
  useEffect(() => {
    if (gateFocusIdx === 0 && inputRef.current) {
      inputRef.current.focus();
    } else if (gateFocusIdx === 1 && rememberRef.current) {
      rememberRef.current.focus();
    } else if (gateFocusIdx === 2 && connectBtnRef.current) {
      connectBtnRef.current.focus();
}
  }, [gateFocusIdx]);

  // Handle local D-pad/keyboard navigation
  useEffect(() => {
    const handleGateKeys = (e: KeyboardEvent) => {
      if (status === 'success') return; // Do not navigate if transitioned successfully

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setGateFocusIdx(prev => (prev > 0 ? prev - 1 : 2));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setGateFocusIdx(prev => (prev < 2 ? prev + 1 : 0));
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          // Allow internal cursor moving for input if focused, else shift focus
          if (gateFocusIdx === 1) {
            e.preventDefault();
            setGateFocusIdx(prev => (prev === 1 ? 3 : 1));
          }
          break;
        case 'Enter':
          // If focused on remember box, toggle it
          if (gateFocusIdx === 1) {
            e.preventDefault();
            setRemember(curr => !curr);
          } else if (gateFocusIdx === 2) {
            e.preventDefault();
            handleConnect();
}
          break;
        case 'Backspace':
          // Prevent backspace from doing page load backing unless within input
          if (gateFocusIdx !== 0) {
            e.preventDefault();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleGateKeys);
    return () => window.removeEventListener('keydown', handleGateKeys);
  }, [gateFocusIdx, address, remember, status]);

  // Auto-connect check if saved and remembered previously
  useEffect(() => {
    const autoConn = localStorage.getItem('strom_remember_connection') === 'true';
    if (autoConn && localStorage.getItem('strom_server_address')) {
      setStatus('connecting');
      setStatusMessage('Auto-connecting to saved media node...');
      
      const t = setTimeout(() => {
        setStatus('success');
        setStatusMessage('Sync Complete! Mounting streams...');
        
        const launchTimer = setTimeout(() => {
          onConnected(address);
        }, 1200);
        return () => clearTimeout(launchTimer);
      }, 1500);
      return () => clearTimeout(t);
    }
  }, []);

  const handleConnect = () => {
    if (!address.trim()) {
      setStatus('error');
      setStatusMessage('Please specify a valid server host IP');
      return;
    }

    setStatus('connecting');
    setStatusMessage('Pinging server host at ' + address + '...');

    // Simulate high fidelity loading/pinging sequence
    setTimeout(() => {
      setStatusMessage('Handshaking with Strøm TV Daemon...');
      
      setTimeout(() => {
        setStatus('success');
        setStatusMessage('Connected successfully! Synchronizing catalog...');
        
        // Save state elements
        localStorage.setItem('strom_server_address', address);
        localStorage.setItem('strom_remember_connection', remember ? 'true' : 'false');
        
        setTimeout(() => {
          onConnected(address);
        }, 1300);
      }, 1000);
    }, 1200);
  };


  // Styling helpers
  const isTizen = targetPlatform === 'tizen-tv';
  const themeColor = isTizen ? 'cyan' : 'orange';
  const ringStyle = isTizen ? 'focus:ring-cyan-500' : 'focus:ring-orange-500';
  const glowShadow = isTizen ? 'shadow-cyan-500/20' : 'shadow-orange-500/20';

  return (
    <div className="min-h-screen bg-[#030303] text-zinc-100 flex flex-col items-center justify-center p-6 relative overflow-hidden select-none">
      
      {/* Background Ambience Blobs */}
      <div className="absolute inset-0 opacity-30 pointer-events-none z-0 overflow-hidden">
        <div className={`absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full filter blur-[130px] transition-all duration-1000 ${
          status === 'connecting' 
            ? 'bg-amber-600/20' 
            : status === 'success' 
            ? 'bg-emerald-600/20' 
            : isTizen 
            ? 'bg-cyan-600/25' 
            : 'bg-orange-600/25'
        }`}></div>
        <div className="absolute -bottom-20 -right-20 w-[400px] h-[400px] bg-zinc-900/40 rounded-full filter blur-[100px]"></div>
      </div>

      <div className="relative z-10 w-full max-w-lg flex flex-col items-center">
        
        {/* Strøm wordmark logo — compact for TV/mobile */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="mb-6 flex items-center justify-center"
        >
          <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 700, fontSize: '3rem', letterSpacing: '-0.02em', lineHeight: 1 }}>
            <span style={{ color: '#ffffff' }}>Str</span>
            <span style={{
              color: '#f97316',
              textShadow: '0 0 18px rgba(249,115,22,0.8), 0 0 35px rgba(249,115,22,0.4)',
            }}>ø</span>
            <span style={{ color: '#ffffff' }}>m</span>
          </div>
        </motion.div>

        {/* Input Details Overlay Container */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="w-full bg-zinc-950/70 backdrop-blur-2xl border border-zinc-800/80 rounded-2xl p-6 shadow-[0_24px_50px_rgba(0,0,0,0.8)]"
        >
          {/* Status light strip */}
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-900">
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase">System Hub Connection</span>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase text-zinc-400">
                {status === 'idle' && 'Awaiting'}
                {status === 'connecting' && 'Verifying...'}
                {status === 'success' && 'Ready'}
                {status === 'error' && 'Unreachable'}
              </span>
              <span className={`w-2.5 h-2.5 rounded-full relative ${
                status === 'idle' 
                  ? 'bg-amber-500' 
                  : status === 'connecting' 
                  ? 'bg-yellow-400 animate-pulse' 
                  : status === 'success' 
                  ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' 
                  : 'bg-red-500'
              }`}>
                {status === 'connecting' && (
                  <span className="absolute inset-0 rounded-full bg-yellow-400 opacity-75 animate-ping"></span>
                )}
              </span>
            </div>
          </div>

          <div className="space-y-5">
            {/* Address input */}
            <div className="space-y-1.5">
              <label className="text-[10px] tracking-wider font-mono text-zinc-400 uppercase flex items-center gap-1.5">
                <Server size={11} className={`text-${themeColor}-400`} />
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
                  onFocus={() => setGateFocusIdx(0)}
                  className={`w-full bg-zinc-900/60 border border-zinc-800 rounded-xl py-3 pl-10 pr-4 text-sm font-mono text-white placeholder-zinc-600 transition-all duration-300 focus:outline-none focus:bg-zinc-900 focus:border-zinc-700 focus:ring-2 ${ringStyle} ${status === 'success' ? 'opacity-50' : ''}`}
                />
                <Wifi size={14} className="absolute left-3.5 top-3.5 text-zinc-500" />
              </div>
            </div>

            {/* Remember connection checkpoint */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  ref={rememberRef}
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  onFocus={() => setGateFocusIdx(1)}
                  disabled={status === 'connecting' || status === 'success'}
                  className={`rounded border-zinc-800 bg-zinc-900/60 text-orange-500 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black ${ringStyle}`}
                />
                <span className="text-xs text-zinc-400 font-sans">Remember host connection</span>
              </label>
              
            </div>

            {/* CTA Join Button */}
            <button
              ref={connectBtnRef}
              onClick={handleConnect}
              onFocus={() => setGateFocusIdx(2)}
              disabled={status === 'connecting' || status === 'success'}
              className={`w-full relative py-3.5 px-6 rounded-xl font-bold font-sans text-xs uppercase tracking-widest text-black flex items-center justify-center gap-2 transition-all duration-300 group shadow-lg ${
                status === 'success'
                  ? 'bg-emerald-500'
                  : isTizen
                  ? 'bg-cyan-400 hover:bg-cyan-300 active:scale-98'
                  : 'bg-orange-500 hover:bg-orange-400 active:scale-98'
              } ${gateFocusIdx === 2 ? `ring-4 ${isTizen ? 'ring-cyan-400' : 'ring-orange-500'} ring-offset-4 ring-offset-zinc-950 scale-[1.02]` : ''} disabled:opacity-80`}
            >
              {status === 'connecting' ? (
                <>
                  <RefreshCw size={14} className="animate-spin text-black" />
                  <span>Connecting to Node...</span>
                </>
              ) : status === 'success' ? (
                <>
                  <CheckCircle size={14} className="text-black" />
                  <span>Interactive Handshake Success</span>
                </>
              ) : (
                <>
                  <Play size={11} fill="black" />
                  <span>Connect Server</span>
                  <ArrowRight size={13} className="ml-0.5 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </button>
            
          </div>

          {/* Prompt status display text */}
          <div className="mt-5 text-center transition-all duration-300">
            <span className={`text-[10px] font-mono tracking-wide ${
              status === 'error' ? 'text-red-400' : status === 'success' ? 'text-emerald-400 font-bold' : 'text-zinc-500'
            }`}>
              {statusMessage}
            </span>
          </div>

        </motion.div>

        {/* Info tips regarding remote simulation functionality */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-8 text-center space-y-1.5"
        >
          <p className="text-[10px] font-mono text-zinc-500 tracking-wider">
            Tip: Press <kbd className="bg-zinc-900 px-1 py-0.5 rounded text-zinc-300">▲</kbd> / <kbd className="bg-zinc-900 px-1 py-0.5 rounded text-zinc-300">▼</kbd> to jump focus, and <kbd className="bg-zinc-900 px-1 py-0.5 rounded text-zinc-300">Enter</kbd> to activate.
          </p>
          <p className="text-[9px] text-zinc-600 uppercase font-sans tracking-widest font-semibold">
            Strøm Cinema Gateway v1.4.2 stable
          </p>
        </motion.div>

      </div>
    </div>
  );
}
