import React from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, CornerDownLeft, Laptop, Tv, VolumeX, Volume2, Settings } from 'lucide-react';

interface OnScreenRemoteProps {
  isTvMode: boolean;
  setIsTvMode: (mode: boolean) => void;
  onDpadUp: () => void;
  onDpadDown: () => void;
  onDpadLeft: () => void;
  onDpadRight: () => void;
  onDpadSelect: () => void;
  onDpadBack: () => void;
  targetPlatform: 'windows' | 'android-tv' | 'tizen-tv';
  onChangeTargetPlatform: (platform: 'windows' | 'android-tv' | 'tizen-tv') => void;
}

export default function OnScreenRemote({
  isTvMode,
  setIsTvMode,
  onDpadUp,
  onDpadDown,
  onDpadLeft,
  onDpadRight,
  onDpadSelect,
  onDpadBack,
  targetPlatform,
  onChangeTargetPlatform,
}: OnScreenRemoteProps) {
  // Sound synthesizer for realistic remote click audio based on active brand profiles
  const playClickSound = (defaultFreq = 420) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      // Customize beep pitch: Samsung controllers use crisp, higher-pitched ticks (750Hz), Android uses mid-tones (440Hz)
      const freq = targetPlatform === 'tizen-tv' ? 720 : defaultFreq;
      
      oscillator.frequency.value = freq;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.08);
    } catch (e) {
      // Ignored if sound is blocked or unsupported by browser sandbox
    }
  };

  const handleAction = (cb: () => void, clickFreq = 420) => {
    playClickSound(clickFreq);
    cb();
  };

  return (
    <div id="remote-controller-container" className="fixed bottom-6 right-6 z-50 flex flex-col items-center select-none">
      {/* Platform Deployment Preset Switcher */}
      <div className="flex items-center bg-black/50 border border-white/5 backdrop-blur-xl rounded-full p-1 mb-3 shadow-2xl">
        <button
          id="toggle-platform-windows"
          onClick={() => handleAction(() => onChangeTargetPlatform('windows'), 380)}
          className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase rounded-full transition-all duration-300 cursor-pointer ${
            targetPlatform === 'windows'
              ? 'bg-orange-500 text-black shadow-md'
              : 'text-zinc-400 hover:text-white'
          }`}
          title="Switch to Windows Desktop App Profile"
        >
          <Laptop size={11} />
          <span>Windows / Web</span>
        </button>

        <button
          id="toggle-platform-android-tv"
          onClick={() => handleAction(() => onChangeTargetPlatform('android-tv'), 520)}
          className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase rounded-full transition-all duration-300 cursor-pointer ${
            targetPlatform === 'android-tv'
              ? 'bg-orange-500 text-black shadow-md'
              : 'text-zinc-400 hover:text-white'
          }`}
          title="Switch to Android TV (Google Cast) Profile"
        >
          <Tv size={11} />
          <span>Android TV</span>
        </button>

        <button
          id="toggle-platform-tizen-tv"
          onClick={() => handleAction(() => onChangeTargetPlatform('tizen-tv'), 520)}
          className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase rounded-full transition-all duration-300 cursor-pointer ${
            targetPlatform === 'tizen-tv'
              ? 'bg-cyan-400 text-black shadow-md'
              : 'text-zinc-400 hover:text-white'
          }`}
          title="Switch to Samsung Tizen OS Smart TV Profile"
        >
          <Tv size={11} />
          <span>Samsung Tizen</span>
        </button>
      </div>

      {/* Simulated physical layout controllers for smart TVs */}
      {isTvMode && (
        <div 
          id="tv-remote-wheel"
          className={`bg-[#0c0c0e]/95 border p-4 rounded-3xl backdrop-blur-2xl flex flex-col items-center gap-4 shadow-[0_20px_50px_rgba(0,0,0,0.8)] w-48 transition-all duration-500 animate-in fade-in slide-in-from-bottom-5 ${
            targetPlatform === 'tizen-tv' ? 'border-cyan-500/20 shadow-[0_0_20px_rgba(34,211,238,0.15)]' : 'border-white/5'
          }`}
        >
          {/* Top Branding Panel */}
          <div className="flex justify-between w-full px-2 text-[10px] font-mono tracking-widest text-zinc-500 italic">
            <span>{targetPlatform === 'tizen-tv' ? 'SAMSUNG_OS' : 'ANDROID_OS'}</span>
            <span className={targetPlatform === 'tizen-tv' ? 'text-cyan-400 font-bold' : 'text-orange-500 font-bold'}>
              ● LIVE
            </span>
          </div>

          {/* Wheel Frame */}
          <div className={`relative w-36 h-36 bg-zinc-900 rounded-full border flex items-center justify-center p-3 shadow-inner ${
            targetPlatform === 'tizen-tv' ? 'border-cyan-900/40' : 'border-zinc-850'
          }`}>
            {/* OK button */}
            <button
              id="remote-center-select"
              onClick={() => handleAction(onDpadSelect, 600)}
              className={`absolute w-14 h-14 bg-black rounded-full border hover:bg-zinc-800 active:scale-90 text-xs font-black flex items-center justify-center shadow-lg transition-all focus:outline-none z-10 cursor-pointer ${
                targetPlatform === 'tizen-tv' 
                  ? 'border-cyan-500/30 text-cyan-400 hover:border-cyan-400 hover:text-cyan-300' 
                  : 'border-white/10 text-orange-500'
              }`}
              title="Select (Enter Key)"
            >
              OK
            </button>

            {/* UP button */}
            <button
              id="remote-button-up"
              onClick={() => handleAction(onDpadUp, 480)}
              className="absolute top-1 w-12 h-10 hover:text-white active:scale-95 text-zinc-400 flex items-center justify-center transition-all cursor-pointer focus:outline-none"
              title="Arrow Up"
            >
              <ChevronUp size={24} className={targetPlatform === 'tizen-tv' ? 'hover:text-cyan-400' : ''} />
            </button>

            {/* DOWN button */}
            <button
              id="remote-button-down"
              onClick={() => handleAction(onDpadDown, 400)}
              className="absolute bottom-1 w-12 h-10 hover:text-white active:scale-95 text-zinc-400 flex items-center justify-center transition-all cursor-pointer focus:outline-none"
              title="Arrow Down"
            >
              <ChevronDown size={24} className={targetPlatform === 'tizen-tv' ? 'hover:text-cyan-400' : ''} />
            </button>

            {/* LEFT button */}
            <button
              id="remote-button-left"
              onClick={() => handleAction(onDpadLeft, 440)}
              className="absolute left-1 h-12 w-10 hover:text-white active:scale-95 text-zinc-400 flex items-center justify-center transition-all cursor-pointer focus:outline-none"
              title="Arrow Left"
            >
              <ChevronLeft size={24} className={targetPlatform === 'tizen-tv' ? 'hover:text-cyan-400' : ''} />
            </button>

            {/* RIGHT button */}
            <button
              id="remote-button-right"
              onClick={() => handleAction(onDpadRight, 460)}
              className="absolute right-1 h-12 w-10 hover:text-white active:scale-95 text-zinc-400 flex items-center justify-center transition-all cursor-pointer focus:outline-none"
              title="Arrow Right"
            >
              <ChevronRight size={24} className={targetPlatform === 'tizen-tv' ? 'hover:text-cyan-400' : ''} />
            </button>
          </div>

          {/* Lower buttons */}
          <div className="grid grid-cols-2 gap-3 w-full">
            <button
              id="remote-button-back"
              onClick={() => handleAction(onDpadBack, 350)}
              className="flex items-center justify-center gap-1 py-1.5 bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white active:bg-zinc-800 rounded-xl text-[10px] font-semibold cursor-pointer transition-all focus:outline-none"
              title="Back (Escape / Backspace)"
            >
              <CornerDownLeft size={10} />
              <span>BACK</span>
            </button>

            <button
              id="remote-button-mute"
              onClick={() => playClickSound(300)}
              className="flex items-center justify-center gap-1 py-1.5 bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white active:bg-zinc-800 rounded-xl text-[10px] font-semibold cursor-pointer transition-all focus:outline-none"
              title="Simulated remote feedback click scale test"
            >
              <Volume2 size={10} />
              <span>FEEDBACK</span>
            </button>
          </div>

          {/* Smart Remote Keyboard Guide */}
          <div className="text-[9px] text-zinc-500 text-center leading-tight">
            Use computer keyboard <br />
            <kbd className="bg-zinc-900 px-1 border border-zinc-800 text-zinc-300 font-mono">▲ ▼ ◀ ▶</kbd> + <kbd className="bg-zinc-900 px-1 border border-zinc-800 text-zinc-300 font-mono">Enter</kbd>
          </div>
        </div>
      )}
    </div>
  );
}
