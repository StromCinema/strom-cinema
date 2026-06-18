import React from 'react';

interface StromCinemaLogoProps {
  className?: string;
}

export default function StromCinemaLogo({ className = '' }: StromCinemaLogoProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center select-none ${className}`}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 500 480"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full max-w-[320px] sm:max-w-[360px] md:max-w-[400px] transition-transform duration-700 hover:scale-[1.02]"
        aria-label="Strøm Cinematic Symbol"
      >
        <defs>
          {/* Main fiery cinema gradient for the foreground elements */}
          <linearGradient id="cinema-orange-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fff3d1" />
            <stop offset="25%" stopColor="#ffd000" />
            <stop offset="70%" stopColor="#ff6200" />
            <stop offset="100%" stopColor="#ff3c00" />
          </linearGradient>

          {/* Solid rich white text gradient */}
          <linearGradient id="cinema-white-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#eaeaea" />
          </linearGradient>

          {/* Subtly colored linear gradient for tagline spacing */}
          <linearGradient id="tagline-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ffb347" />
            <stop offset="100%" stopColor="#ffcc33" />
          </linearGradient>
        </defs>

        {/* SECTION 1: THE MAJESTIC LIGHTNING-GLOW Ø SYMBOL */}
        <g id="giant-cinema-symbol">
          {/* Layer 1: Volumetric Deep Ambient Red-Orange Atmosphere (Blur 32px) */}
          <g className="opacity-30 blur-2xl">
            <circle cx="250" cy="180" r="75" fill="none" stroke="#ff2200" strokeWidth="28" />
            <path d="M 155 275 L 345 85" stroke="#ff2200" strokeWidth="28" strokeLinecap="round" />
          </g>

          {/* Layer 2: Core Bright Orange Fire (Blur 12px) */}
          <g className="opacity-55 blur-md">
            <circle cx="250" cy="180" r="75" fill="none" stroke="#ff7300" strokeWidth="20" />
            <path d="M 155 275 L 345 85" stroke="#ff7300" strokeWidth="20" strokeLinecap="round" />
          </g>

          {/* Layer 3: Warm Concentrated Sun Gold (Blur 3px) */}
          <g className="opacity-80 blur-[3px]">
            <circle cx="250" cy="180" r="75" fill="none" stroke="#ffbf00" strokeWidth="15" />
            <path d="M 155 275 L 345 85" stroke="#ffbf00" strokeWidth="15" strokeLinecap="round" />
          </g>

          {/* Layer 4: Hot White Incandescent Filament (Blur 1px) */}
          <g className="opacity-95 blur-[1px]">
            <circle cx="250" cy="180" r="75" fill="none" stroke="#fffce0" strokeWidth="11" />
            <path d="M 155 275 L 345 85" stroke="#fffce0" strokeWidth="11" strokeLinecap="round" />
          </g>

          {/* Layer 5: Sharp High Dynamic Range Foreground Path */}
          <g>
            <circle
              cx="250"
              cy="180"
              r="75"
              fill="none"
              stroke="url(#cinema-orange-grad)"
              strokeWidth="11"
            />
            <path
              d="M 155 275 L 345 85"
              stroke="url(#cinema-orange-grad)"
              strokeWidth="11"
              strokeLinecap="round"
            />
          </g>
        </g>

        {/* SECTION 2: PRECISION-CRAFTED "strøm" GEOMETRIC LETTERS */}
        <g id="strom-letters-group" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          
          {/* LETTER: S (Slot [100, 126]) */}
          <path
            d="M 126,313 L 111,313 C 105,313 100,317 100,323 C 100,327 103,330 111,330 L 115,330 C 121,330 126,333 126,337 C 126,343 121,347 115,347 L 100,347"
            stroke="url(#cinema-white-grad)"
            fill="none"
          />

          {/* LETTER: T (Slot [146, 166]) */}
          <path
            d="M 154,305 L 154,347 M 146,313 L 162,313"
            stroke="url(#cinema-white-grad)"
            fill="none"
          />

          {/* LETTER: R (Slot [186, 210]) */}
          <path
            d="M 191,313 L 191,347 M 191,324 C 191,317 195,313 203,313 L 210,313"
            stroke="url(#cinema-white-grad)"
            fill="none"
          />

          {/* LETTER: GLOWING Ø (Center 250, Radius 14, Slot [230, 270]) */}
          {/* ø - Outer Red bloom layer */}
          <g className="opacity-40 blur-[5px]">
            <circle cx="250" cy="330" r="14" fill="none" stroke="#ff2200" strokeWidth="7" />
            <path d="M 230 350 L 270 310" stroke="#ff2200" strokeWidth="7.5" />
          </g>
          
          {/* ø - Concentrated Yellow bloom layer */}
          <g className="opacity-80 blur-[1px]">
            <circle cx="250" cy="330" r="14" fill="none" stroke="#ffbf00" strokeWidth="4.5" />
            <path d="M 230 350 L 270 310" stroke="#ffbf00" strokeWidth="5" />
          </g>

          {/* ø - Sharp fiery foreground overlay */}
          <g>
            <circle
              cx="250"
              cy="330"
              r="14"
              fill="none"
              stroke="url(#cinema-orange-grad)"
              strokeWidth="3.4"
            />
            <path
              d="M 230 350 L 270 310"
              stroke="url(#cinema-orange-grad)"
              strokeWidth="3.6"
            />
          </g>

          {/* LETTER: M (Slot [290, 328]) */}
          <path
            d="M 293,347 L 293,322 C 293,316 297,313 303,313 C 308,313 311,316 311,322 L 311,347"
            stroke="url(#cinema-white-grad)"
            fill="none"
          />
          <path
            d="M 311,322 C 311,316 315,313 321,313 C 327,313 327,316 327,322 L 327,347"
            stroke="url(#cinema-white-grad)"
            fill="none"
          />
        </g>

        {/* SECTION 3: WIDE-TRACKING CINEMATIC TAGLINE */}
        <text
          x="250"
          y="396"
          fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          fontSize="11.5px"
          fontWeight="bold"
          letterSpacing="0.45em"
          fill="url(#tagline-grad)"
          textAnchor="middle"
          className="uppercase select-none opacity-90 pl-[0.45em]"
        >
          POWER YOUR CINEMA
        </text>

        {/* SECTION 4: THE HORIZONTAL PROJECTOR LENS FLARE AT THE BOTTOM */}
        <g id="lens-flare-effect" className="opacity-80">
          {/* Subtle horizontal baseline bar */}
          <line
            x1="180"
            y1="436"
            x2="320"
            y2="436"
            stroke="#ff5100"
            strokeWidth="2"
            className="blur-[2px]"
          />
          {/* Hot core flare light */}
          <line
            x1="220"
            y1="436"
            x2="280"
            y2="436"
            stroke="#fff1cc"
            strokeWidth="1"
            className="blur-[0.5px]"
          />
        </g>
      </svg>
    </div>
  );
}
