import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Home, 
  Film, 
  Tv, 
  Layers, 
  Video, 
  Music, 
  Folder, 
  Settings, 
  Plus, 
  ChevronRight,
  Compass,
  Sparkles,
  Skull,
  Flame,
  Trophy,
  Heart,
  Zap
} from 'lucide-react';
import { LibraryPath, TrackerCategory } from '../types';

interface SidebarProps {
  libraryPaths: LibraryPath[];
  isExpanded: boolean;
  isFocused: boolean;
  focusedIndex: number;
  selectedPathId: string | null; // null means 'Home'
  onSelectCategory: (pathId: string | null) => void;
  onGoToSettings: () => void;
  targetPlatform: 'windows' | 'android-tv' | 'tizen-tv';
  trackerCategories?: TrackerCategory[];
  selectedTrackerCategory?: string | null;
  onSelectTrackerCategory?: (key: string) => void;
  showStreamingItem?: boolean;
  isStreamingSelected?: boolean;
  onSelectStreaming?: () => void;
}

export default function Sidebar({
  libraryPaths,
  isExpanded,
  isFocused,
  focusedIndex,
  selectedPathId,
  onSelectCategory,
  onGoToSettings,
  targetPlatform,
  trackerCategories = [],
  selectedTrackerCategory,
  onSelectTrackerCategory,
  showStreamingItem = false,
  isStreamingSelected = false,
  onSelectStreaming,
}: SidebarProps) {
  
  // Custom helper to pair a category name to a Lucide icon
  const getCategoryIcon = (category?: string) => {
    const cat = (category || '').toLowerCase();
    
    // Documentaries
    if (
      cat.includes('doc') || 
      cat.includes('fact') || 
      cat.includes('histor') || 
      cat.includes('science') || 
      cat.includes('nature') || 
      cat.includes('edu') ||
      cat.includes('real')
    ) return Compass;
    
    // Cartoons / Animation
    if (
      cat.includes('cartoon') || 
      cat.includes('anim') || 
      cat.includes('kid') || 
      cat.includes('child') || 
      cat.includes('toy') || 
      cat.includes('family') ||
      cat.includes('draw')
    ) return Sparkles;
    
    // Horror / Thriller
    if (
      cat.includes('horror') || 
      cat.includes('scary') || 
      cat.includes('spook') || 
      cat.includes('thrill') || 
      cat.includes('ghost') ||
      cat.includes('scare')
    ) return Skull;
    
    // Action / Adventure
    if (
      cat.includes('action') || 
      cat.includes('fight') || 
      cat.includes('war') || 
      cat.includes('hero') || 
      cat.includes('gun') ||
      cat.includes('explos')
    ) return Flame;
    
    // Sports / Fitness
    if (
      cat.includes('sport') || 
      cat.includes('fit') || 
      cat.includes('game') || 
      cat.includes('gym') ||
      cat.includes('match')
    ) return Trophy;

    // Drama / Romance / Love / Comedy
    if (
      cat.includes('drama') || 
      cat.includes('romanc') || 
      cat.includes('love') ||
      cat.includes('comedy') ||
      cat.includes('laugh')
    ) return Heart;

    if (cat.includes('movie') || cat.includes('film')) return Film;
    if (cat.includes('show') || cat.includes('tv') || cat.includes('series')) return Tv;
    if (cat.includes('home') || cat.includes('personal')) return Video;
    if (cat.includes('music')) return Music;
    return Folder;
  };

  // Auto-scroll sidebar so the focused item stays visible when navigating with D-pad
  useEffect(() => {
    if (!isFocused) return;
    // Determine which element id is focused
    const sidebarItems = [
      'all-browse',
      ...libraryPaths.map(p => p.id),
      'settings',
      ...(showStreamingItem ? ['streaming'] : []),
      ...trackerCategories.map(c => c.key),
    ];
    const focusedId = sidebarItems[focusedIndex];
    if (!focusedId) return;

    const elementId = focusedId.startsWith('all-browse') || focusedId === 'settings'
      ? `sidebar-item-${focusedId}`
      : trackerCategories.some(c => c.key === focusedId)
        ? `sidebar-tracker-${focusedId}`
        : `sidebar-item-${focusedId}`;

    const el = document.getElementById(elementId);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedIndex, isFocused, libraryPaths, trackerCategories]);

  const accentColorClass = targetPlatform === 'tizen-tv'
    ? 'text-cyan-400 group-hover:text-cyan-300'
    : 'text-orange-500 group-hover:text-orange-400';

  const ringColorClass = targetPlatform === 'tizen-tv'
    ? 'ring-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)] border-cyan-400/50'
    : 'ring-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.4)] border-orange-500/50';

  const activeBgClass = targetPlatform === 'tizen-tv'
    ? 'bg-cyan-500/15 text-cyan-400 border-l-4 border-cyan-400'
    : 'bg-orange-500/15 text-orange-400 border-l-4 border-orange-500';

  // We append specialized top level navigation rows
  // Index 0: Home
  // Index 1..N: Library categories
  // Index N+1: Settings
  const sidebarItems = [
    { id: 'all-browse', label: 'All Browse', path: null, category: 'Home', icon: Home },
    ...libraryPaths.map(p => ({
      id: p.id,
      label: p.category || 'Movies',
      path: p.path,
      category: p.category,
      icon: getCategoryIcon(p.category)
    })),
    { id: 'settings', label: 'Settings', path: null, category: 'Settings', icon: Settings }
  ];

  return (
    <motion.aside
      id="plexus-left-navigation-sidebar"
      initial={false}
      animate={{ 
        width: isExpanded ? 260 : 72,
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={`fixed top-0 left-0 h-screen z-50 flex flex-col justify-between border-r border-white/5 bg-[#080808]/90 backdrop-blur-3xl shadow-2xl overflow-hidden`}
    >
      {/* Upper Brand / Logo Segment */}
      <div className="p-5 flex items-center gap-3 border-b border-white/5 h-20 flex-shrink-0">
        <div className={`p-2 rounded-lg bg-zinc-900 border border-white/5 flex-shrink-0 transition-all ${
          isFocused ? 'ring-2 ' + ringColorClass : ''
        }`}>
          <Film size={18} className={isExpanded ? accentColorClass : 'text-slate-400'} />
        </div>
        {isExpanded && (
          <motion.div 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col min-w-0"
          >
            <span className="font-sans font-black tracking-widest text-sm text-white leading-none">STRØM</span>
            <span className="text-[8px] font-mono tracking-widest text-zinc-500 uppercase mt-0.5 font-bold">POWER YOUR CINEMA</span>
          </motion.div>
        )}
      </div>

      {/* Middle List of Categories */}
      <div className="flex-1 overflow-y-auto px-2 py-4 space-y-1.5 scrollbar-none select-none">
        {sidebarItems.map((item, idx) => {
          const isItemFocused = isFocused && focusedIndex === idx;
          const isItemActive = item.id === 'all-browse' 
            ? selectedPathId === null 
            : item.id === 'settings' 
              ? false 
              : selectedPathId === item.id;

          const IconComponent = item.icon;

          return (
            <div
              key={item.id}
              id={`sidebar-item-${item.id}`}
              onClick={() => {
                if (item.id === 'settings') {
                  onGoToSettings();
                } else if (item.id === 'all-browse') {
                  onSelectCategory(null);
                } else {
                  onSelectCategory(item.id);
                }
              }}
              className={`group flex items-center justify-between px-3.5 py-3 rounded-xl cursor-pointer transition-all duration-200 ${
                isItemActive 
                  ? activeBgClass 
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              } ${
                isItemFocused 
                  ? `ring-2 ${ringColorClass} scale-[1.03] bg-zinc-900/40 text-white z-10` 
                  : ''
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <IconComponent 
                  size={18} 
                  className={`flex-shrink-0 transition-colors ${
                    isItemActive ? '' : isItemFocused ? accentColorClass : 'group-hover:text-white'
                  }`} 
                />
                
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex flex-col min-w-0"
                  >
                    <span className="text-xs font-bold font-sans tracking-wide truncate">{item.label}</span>
                    {item.path && (
                      <span className="text-[8px] font-mono text-zinc-500 truncate max-w-[150px]">
                        {item.path}
                      </span>
                    )}
                  </motion.div>
                )}
              </div>

              {isExpanded && isItemFocused && (
                <ChevronRight size={12} className={accentColorClass} />
              )}
            </div>
          );
        })}

        {/* STREAMING — shown when TrackerFlix is connected and has providers */}
        {showStreamingItem && (
          <>
            <div className="px-3.5 pt-3 pb-1 flex items-center gap-2">
              <div className="flex-1 h-px bg-white/5" />
              {isExpanded && (
                <span className="text-[8px] font-mono font-bold tracking-widest text-zinc-500 uppercase flex-shrink-0">
                  Catalog
                </span>
              )}
              <div className="flex-1 h-px bg-white/5" />
            </div>
            {(() => {
              const streamingFocusIdx = 2 + libraryPaths.length; // 0=home, 1..N=paths, N+1=settings, N+2=streaming
              const isItemFocused = isFocused && focusedIndex === streamingFocusIdx;
              return (
                <div
                  id="sidebar-item-streaming"
                  onClick={() => onSelectStreaming?.()}
                  className={`group flex items-center justify-between px-3.5 py-3 rounded-xl cursor-pointer transition-all duration-200 ${
                    isStreamingSelected
                      ? activeBgClass
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  } ${
                    isItemFocused
                      ? `ring-2 ${ringColorClass} scale-[1.03] bg-zinc-900/40 text-white z-10`
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Layers
                      size={18}
                      className={`flex-shrink-0 transition-colors ${
                        isStreamingSelected ? '' : isItemFocused ? accentColorClass : 'group-hover:text-white'
                      }`}
                    />
                    {isExpanded && (
                      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col min-w-0">
                        <span className="text-xs font-bold font-sans tracking-wide truncate">Streaming</span>
                      </motion.div>
                    )}
                  </div>
                  {isExpanded && isItemFocused && (
                    <ChevronRight size={12} className={accentColorClass} />
                  )}
                </div>
              );
            })()}
          </>
        )}

        {/* TORRENT LIBRARY — tracker categories from TrackerFlix */}
        {trackerCategories.length > 0 && (
          <>
            {/* Divider */}
            <div className="px-3.5 pt-3 pb-1 flex items-center gap-2">
              <div className="flex-1 h-px bg-white/5" />
              {isExpanded && (
                <span className="text-[8px] font-mono font-bold tracking-widest text-zinc-500 uppercase flex-shrink-0">
                  Torrent Library
                </span>
              )}
              <div className="flex-1 h-px bg-white/5" />
            </div>

            {trackerCategories.map((cat, catIdx) => {
              // Focus index: 0=home, 1..N=library paths, N+1=settings, N+2=streaming (if shown), N+2or3..=tracker cats
              const trackerFocusIdx = 2 + libraryPaths.length + (showStreamingItem ? 1 : 0) + catIdx;
              const isItemFocused = isFocused && focusedIndex === trackerFocusIdx;
              const isItemActive = selectedTrackerCategory === cat.key;

              return (
                <div
                  key={cat.key}
                  id={`sidebar-tracker-${cat.key}`}
                  onClick={() => onSelectTrackerCategory?.(cat.key)}
                  className={`group flex items-center justify-between px-3.5 py-3 rounded-xl cursor-pointer transition-all duration-200 ${
                    isItemActive
                      ? 'bg-violet-500/15 text-violet-400 border-l-4 border-violet-500'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  } ${
                    isItemFocused
                      ? `ring-2 ${ringColorClass} scale-[1.03] bg-zinc-900/40 text-white z-10`
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Zap
                      size={18}
                      className={`flex-shrink-0 transition-colors ${
                        isItemActive
                          ? 'text-violet-400'
                          : isItemFocused
                          ? 'text-violet-400'
                          : 'text-violet-500/60 group-hover:text-violet-400'
                      }`}
                    />
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex flex-col min-w-0"
                      >
                        <span className="text-xs font-bold font-sans tracking-wide truncate">{cat.label}</span>
                      </motion.div>
                    )}
                  </div>
                  {isExpanded && isItemFocused && (
                    <ChevronRight size={12} className="text-violet-400" />
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Footer / Info segment */}
      <div className="p-4 border-t border-white/5 text-center flex-shrink-0">
        {isExpanded ? (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col space-y-1 text-[9px] font-mono text-zinc-500"
          >
            <span>STRØM CINEMA</span>
            <span className="text-[8px] text-zinc-650">Made by patchbyte</span>
          </motion.div>
        ) : (
          <div className="w-2 h-2 rounded-full bg-emerald-500 mx-auto animate-pulse" />
        )}
      </div>
    </motion.aside>
  );
}
