<template>
  <div class="prudent-metal" aria-hidden="true">
    <svg viewBox="0 0 600 700" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <!-- Chrome banding ACROSS the stream's width.
             Sharp light/dark bands are what reads as polished metal. -->
        <linearGradient id="pm-chrome" x1="0" y1="0.5" x2="1" y2="0.5">
          <stop offset="0%"   stop-color="#0A1245"/>
          <stop offset="10%"  stop-color="#1626A0"/>
          <stop offset="22%"  stop-color="#5C77FF"/>
          <stop offset="32%"  stop-color="#E8ECFF"/>
          <stop offset="38%"  stop-color="#FFFFFF"/>
          <stop offset="46%"  stop-color="#8AA0FF"/>
          <stop offset="58%"  stop-color="#3A58FF"/>
          <stop offset="72%"  stop-color="#1626A0"/>
          <stop offset="84%"  stop-color="#3A58FF"/>
          <stop offset="94%"  stop-color="#5C77FF"/>
          <stop offset="100%" stop-color="#0A1245"/>
        </linearGradient>

        <!-- Wet specular highlight, ridden along the brightest edge -->
        <linearGradient id="pm-spec" x1="0" y1="0.5" x2="1" y2="0.5">
          <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0"/>
          <stop offset="34%"  stop-color="#FFFFFF" stop-opacity="0"/>
          <stop offset="40%"  stop-color="#FFFFFF" stop-opacity="0.95"/>
          <stop offset="44%"  stop-color="#FFFFFF" stop-opacity="0"/>
          <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
        </linearGradient>

        <!-- Subtle flow: gentle turbulence + small displacement so the stream
             ripples instead of melts. Scale is intentionally low to preserve edges. -->
        <filter id="pm-flow" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.018" numOctaves="2" seed="9" result="noise">
            <animate
              attributeName="baseFrequency"
              dur="22s"
              values="0.008 0.018; 0.012 0.014; 0.009 0.020; 0.008 0.018"
              repeatCount="indefinite"/>
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="22">
            <animate
              attributeName="scale"
              dur="14s"
              values="18; 30; 22; 18"
              repeatCount="indefinite"/>
          </feDisplacementMap>
        </filter>

        <!-- Shared ribbon path: an S-curve that pours down and to the right.
             Defined once so the fill, highlight, and rim share geometry. -->
        <path id="pm-stream"
              d="M 340 -40
                 C 220 100, 460 220, 320 340
                 S 200 560, 380 740"/>
      </defs>

      <g class="pm-drift" filter="url(#pm-flow)">
        <!-- Soft outer glow rim -->
        <use href="#pm-stream"
             stroke="#3A58FF"
             stroke-opacity="0.35"
             stroke-width="200"
             stroke-linecap="round"
             fill="none"
             filter="url(#pm-glow)"/>
        <!-- Main chrome body -->
        <use href="#pm-stream"
             stroke="url(#pm-chrome)"
             stroke-width="170"
             stroke-linecap="round"
             fill="none"/>
        <!-- Sharp specular highlight rides the bright band -->
        <use href="#pm-stream"
             stroke="url(#pm-spec)"
             stroke-width="170"
             stroke-linecap="round"
             fill="none"
             class="pm-spec"/>
        <!-- A thin crisp rim catches light on the silhouette edge -->
        <use href="#pm-stream"
             stroke="#E8ECFF"
             stroke-opacity="0.45"
             stroke-width="2"
             stroke-linecap="round"
             fill="none"/>
      </g>

      <!-- Outer glow filter (separate so it doesn't get displaced as hard) -->
      <defs>
        <filter id="pm-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="22"/>
        </filter>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
.prudent-metal {
  width: 100%;
  max-width: 540px;
  aspect-ratio: 6 / 7;
  margin: 0 auto;
  filter: drop-shadow(0 22px 70px rgba(58, 88, 255, 0.35));
}
.prudent-metal svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* Ambient drift + slow tilt — pairs with the turbulence flow */
.pm-drift {
  transform-origin: 300px 350px;
  animation: pm-drift 26s ease-in-out infinite alternate;
}
@keyframes pm-drift {
  0%   { transform: translate(0, 0)     rotate(-2deg) scale(1); }
  50%  { transform: translate(-6px, 4px) rotate(1.5deg) scale(1.015); }
  100% { transform: translate(5px, -3px) rotate(-0.5deg) scale(0.99); }
}

/* The bright spec highlight shifts position to look like light travelling
   across polished metal. Implemented by translating the spec gradient stroke. */
.pm-spec {
  animation: pm-spec 9s ease-in-out infinite alternate;
}
@keyframes pm-spec {
  0%   { transform: translateX(-10px); }
  100% { transform: translateX(12px); }
}

@media (prefers-reduced-motion: reduce) {
  .pm-drift,
  .pm-spec { animation: none; }
  .prudent-metal svg animate { display: none; }
}
</style>
