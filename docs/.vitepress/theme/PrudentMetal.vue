<template>
  <div class="prudent-metal" aria-hidden="true">
    <svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <!-- Chrome-blue gradient: white highlight → Prudent Blue → deep navy → blue
             Mimics the liquid-metal sculpture in the brand boards. -->
        <linearGradient id="pm-chrome" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%"   stop-color="#FFFFFF"/>
          <stop offset="14%"  stop-color="#E8ECFF"/>
          <stop offset="30%"  stop-color="#7E96FF"/>
          <stop offset="48%"  stop-color="#3A58FF"/>
          <stop offset="62%"  stop-color="#1626A0"/>
          <stop offset="78%"  stop-color="#0A1245"/>
          <stop offset="92%"  stop-color="#3A58FF"/>
          <stop offset="100%" stop-color="#5C77FF"/>
        </linearGradient>

        <!-- Soft spotlight on top to give the chrome a wet highlight -->
        <radialGradient id="pm-spec" cx="0.3" cy="0.25" r="0.5">
          <stop offset="0%"  stop-color="#FFFFFF" stop-opacity="0.85"/>
          <stop offset="40%" stop-color="#FFFFFF" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
        </radialGradient>

        <!-- Liquid distortion: a slow-moving turbulence field displaces the shape.
             Two animated parameters keep it from looping obviously. -->
        <filter id="pm-liquid" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.009 0.013" numOctaves="2" seed="7" result="noise">
            <animate
              attributeName="baseFrequency"
              dur="24s"
              values="0.009 0.013; 0.014 0.008; 0.010 0.015; 0.009 0.013"
              repeatCount="indefinite"/>
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="80">
            <animate
              attributeName="scale"
              dur="16s"
              values="70; 105; 80; 70"
              repeatCount="indefinite"/>
          </feDisplacementMap>
          <feGaussianBlur stdDeviation="0.4"/>
        </filter>
      </defs>

      <!-- Slow drift + rotate group, distorted by the liquid filter -->
      <g class="pm-drift" filter="url(#pm-liquid)">
        <!-- The blob -->
        <ellipse cx="300" cy="300" rx="210" ry="280" fill="url(#pm-chrome)"/>
        <!-- A second offset shape adds depth + irregularity once displaced -->
        <ellipse cx="330" cy="280" rx="120" ry="210" fill="url(#pm-chrome)" opacity="0.55" transform="rotate(-18 330 280)"/>
        <!-- Wet highlight -->
        <ellipse cx="240" cy="220" rx="180" ry="120" fill="url(#pm-spec)"/>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.prudent-metal {
  width: 100%;
  max-width: 520px;
  aspect-ratio: 1 / 1;
  margin: 0 auto;
  filter: drop-shadow(0 18px 60px rgba(58, 88, 255, 0.28));
}
.prudent-metal svg {
  width: 100%;
  height: 100%;
  display: block;
}
/* Slow ambient drift + tilt — pairs with the SVG turbulence to feel alive */
.pm-drift {
  transform-origin: 300px 300px;
  animation: pm-drift 28s ease-in-out infinite alternate;
}
@keyframes pm-drift {
  0%   { transform: translate(0, 0)     rotate(-3deg) scale(1); }
  50%  { transform: translate(-6px, 4px) rotate(2deg)  scale(1.02); }
  100% { transform: translate(4px, -3px) rotate(-1deg) scale(0.99); }
}
@media (prefers-reduced-motion: reduce) {
  .pm-drift { animation: none; }
  .prudent-metal svg animate { display: none; }
}
</style>
