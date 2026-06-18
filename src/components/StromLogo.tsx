import React from 'react';

interface StromLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
}

export default function StromLogo({
  size = 44,
  className = '',
  showText = false,
}: StromLogoProps) {
  // Sizable squircle application icon mirroring the user's uploaded logo exactly
  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 transition-transform duration-300 hover:scale-105"
        aria-label="Strøm Logo"
      >
        <defs>
          {/* Real-time deep glow filter for the orange ø element */}
          <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="16" result="blur1" />
            <feGaussianBlur stdDeviation="28" result="blur2" />
            <feMerge>
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Premium textured background gradient */}
          <radialGradient id="bg-grad" cx="50%" cy="50%" r="50%" fx="50%" fy="30%">
            <stop offset="0%" stopColor="#2c2c2c" />
            <stop offset="60%" stopColor="#141414" />
            <stop offset="100%" stopColor="#080808" />
          </radialGradient>

          {/* Golden/orange glow gradient for the ø character */}
          <linearGradient id="glow-orange" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffd269" />
            <stop offset="50%" stopColor="#ff7b00" />
            <stop offset="100%" stopColor="#ff3c00" />
          </linearGradient>

          {/* Soft off-white subtle gradient for the standard letters (s, t, r, m) */}
          <linearGradient id="text-offwhite" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.8" />
          </linearGradient>

          {/* Subtle inner card border drop-shadow emulation */}
          <linearGradient id="inner-border" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.4" />
          </linearGradient>
        </defs>

        {/* Squircle Background Shape (Apple standards) */}
        <path
          d="M128 0h256c70.7 0 128 57.3 128 128v256c0 70.7-57.3 128-128 128H128C57.3 512 0 454.7 0 384V128C0 57.3 57.3 0 128 0z"
          fill="url(#bg-grad)"
        />
        
        {/* Subtle Inner Highlight Border */}
        <path
          d="M128 4h256c68.5 0 124 55.5 124 124v256c0 68.5-55.5 124-124 124H128C59.5 508 4 452.5 4 384V128C4 59.5 59.5 4 128 4z"
          fill="none"
          stroke="url(#inner-border)"
          strokeWidth="6"
        />

        {/* Lowercase "strøm" Lettering Group */}
        <g id="letters" transform="translate(18, 5)">
          {/* s */}
          <path
            d="M 125 240 C 125 210, 95 210, 95 195 C 95 185, 115 185, 115 195 M 95 235 C 95 265, 125 265, 125 280 C 125 290, 105 290, 105 280"
            fill="none"
            stroke="url(#text-offwhite)"
            strokeWidth="11"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* t */}
          <path
            d="M 160 170 L 160 280 M 145 200 L 175 200"
            fill="none"
            stroke="url(#text-offwhite)"
            strokeWidth="11"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* r */}
          <path
            d="M 200 280 L 200 200 C 200 200, 203 190, 222 195"
            fill="none"
            stroke="url(#text-offwhite)"
            strokeWidth="11"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Glowing ø (Implemented with high-fidelity multi-pass CSS blurs to avoid SVG filter bounding box clipping artifacts) */}
          <g>
            {/* PASS 1: Thick Soft Deep Orange Bloom */}
            <g className="opacity-40 blur-lg">
              <circle cx="290" cy="240" r="40" fill="none" stroke="#ff3c00" strokeWidth="24" />
              <line x1="245" y1="285" x2="335" y2="195" stroke="#ff3c00" strokeWidth="24" strokeLinecap="round" />
            </g>

            {/* PASS 2: Medium Warm Amber Bloom */}
            <g className="opacity-60 blur-sm">
              <circle cx="290" cy="240" r="40" fill="none" stroke="#ff7b00" strokeWidth="16" />
              <line x1="245" y1="285" x2="335" y2="195" stroke="#ff7b00" strokeWidth="16" strokeLinecap="round" />
            </g>

            {/* PASS 3: Bright Gold Inner Core */}
            <g className="opacity-80 blur-[1px]">
              <circle cx="290" cy="240" r="40" fill="none" stroke="#ffd269" strokeWidth="12" />
              <line x1="245" y1="285" x2="335" y2="195" stroke="#ffd269" strokeWidth="12" strokeLinecap="round" />
            </g>

            {/* PASS 4: Sharp Crisp Foreground */}
            <g>
              <circle
                cx="290"
                cy="240"
                r="40"
                fill="none"
                stroke="url(#glow-orange)"
                strokeWidth="11"
              />
              <line
                x1="245"
                y1="285"
                x2="335"
                y2="195"
                stroke="url(#glow-orange)"
                strokeWidth="11"
                strokeLinecap="round"
              />
            </g>
          </g>

          {/* m */}
          <path
            d="M 370 280 L 370 200 C 370 200, 370 185, 395 195 L 395 280 C 395 280, 395 185, 420 195 L 420 280"
            fill="none"
            stroke="url(#text-offwhite)"
            strokeWidth="11"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>

      {showText && (
        <div className="flex flex-col">
          <span className="font-sans font-black tracking-widest text-[16px] text-white leading-none">STRØM</span>
          <span className="text-[9px] font-mono tracking-widest text-slate-400 uppercase font-bold mt-1">Smart Media Hub</span>
        </div>
      )}
    </div>
  );
}
