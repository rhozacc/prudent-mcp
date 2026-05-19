<template>
  <div class="prudent-bg" aria-hidden="true">
    <svg
      class="prudent-svg"
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMax slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <!-- Chrome banding gradient ─ sharp bright/dark transitions read as metal.
             Direction is roughly perpendicular to the ribbon (top-right ↘ bottom-left). -->
        <linearGradient id="pm-chrome" gradientUnits="userSpaceOnUse"
                        x1="1400" y1="200" x2="200" y2="900">
          <stop offset="0%"   stop-color="#0A1245"/>
          <stop offset="8%"   stop-color="#1626A0"/>
          <stop offset="18%"  stop-color="#5C77FF"/>
          <stop offset="28%"  stop-color="#E8ECFF"/>
          <stop offset="34%"  stop-color="#FFFFFF"/>
          <stop offset="40%"  stop-color="#A4B6FF"/>
          <stop offset="50%"  stop-color="#3A58FF"/>
          <stop offset="64%"  stop-color="#1626A0"/>
          <stop offset="78%"  stop-color="#3A58FF"/>
          <stop offset="90%"  stop-color="#1A2A88"/>
          <stop offset="100%" stop-color="#0A1245"/>
        </linearGradient>

        <!-- Soft, slow turbulence — large region so distortion never touches a hard edge. -->
        <filter id="pm-flow" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.0045 0.012"
                        numOctaves="2" seed="11" result="noise">
            <animate
              attributeName="baseFrequency"
              dur="28s"
              values="0.0045 0.012; 0.006 0.009; 0.005 0.014; 0.0045 0.012"
              repeatCount="indefinite"/>
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="60">
            <animate
              attributeName="scale"
              dur="18s"
              values="50; 78; 60; 50"
              repeatCount="indefinite"/>
          </feDisplacementMap>
          <feGaussianBlur stdDeviation="1"/>
        </filter>

        <!-- The ribbon path: starts up high on the right ~38% across, curves
             through the middle, exits off the bottom-left corner. Reused for
             main fill, specular highlight, and glow. -->
        <path id="pm-stream"
              d="M 1700 80
                 C 1450 240, 1250 200, 1100 420
                 S 700 720, 480 820
                 S 60 1060, -180 1100"/>
      </defs>

      <g class="pm-drift">
        <!-- Wide soft blue glow underlay -->
        <use href="#pm-stream"
             stroke="#3A58FF"
             stroke-opacity="0.45"
             stroke-width="420"
             stroke-linecap="round"
             fill="none"
             filter="url(#pm-blur)"/>
        <!-- Main chrome body, with fluid distortion -->
        <g filter="url(#pm-flow)">
          <use href="#pm-stream"
               stroke="url(#pm-chrome)"
               stroke-width="240"
               stroke-linecap="round"
               fill="none"/>
          <!-- Inner bright highlight rides the brightest band -->
          <use href="#pm-stream"
               class="pm-spec"
               stroke="#FFFFFF"
               stroke-opacity="0.9"
               stroke-width="14"
               stroke-linecap="round"
               fill="none"/>
        </g>
      </g>

      <defs>
        <filter id="pm-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="60"/>
        </filter>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
/* Full-bleed behind the hero. The slot is rendered inside .VPHero, which is
 * position:relative — so absolute inset:0 fills it. We mask softly with a
 * radial gradient anchored bottom-left so the top-right ~1/3 is empty and
 * the silhouette has no hard edges. */
.prudent-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
  /* CSS mask: opaque around bottom-left, fading to transparent toward the
   * top-right; keeps the upper-right corner clean for the wordmark + text. */
  -webkit-mask-image:
    radial-gradient(
      ellipse 130% 110% at 18% 95%,
      black 0%,
      black 38%,
      rgba(0, 0, 0, 0.85) 52%,
      rgba(0, 0, 0, 0.35) 70%,
      transparent 86%
    );
          mask-image:
    radial-gradient(
      ellipse 130% 110% at 18% 95%,
      black 0%,
      black 38%,
      rgba(0, 0, 0, 0.85) 52%,
      rgba(0, 0, 0, 0.35) 70%,
      transparent 86%
    );
}
.prudent-svg {
  position: absolute;
  inset: -10% -5% -10% -5%;
  width: 110%;
  height: 120%;
  display: block;
}

/* Slow ambient drift so the form moves even between filter animation cycles. */
.pm-drift {
  transform-origin: 800px 600px;
  animation: pm-drift 32s ease-in-out infinite alternate;
}
@keyframes pm-drift {
  0%   { transform: translate(0, 0)       rotate(-1deg)   scale(1); }
  50%  { transform: translate(-30px, 14px) rotate(0.8deg) scale(1.02); }
  100% { transform: translate(22px, -12px) rotate(-0.4deg) scale(0.99); }
}

/* Specular sheen travels along the ribbon, simulating light raking across metal. */
.pm-spec {
  animation: pm-spec 11s ease-in-out infinite alternate;
}
@keyframes pm-spec {
  0%   { transform: translate(-26px, 18px); opacity: 0.6; }
  50%  { opacity: 1; }
  100% { transform: translate(28px, -16px); opacity: 0.7; }
}

@media (prefers-reduced-motion: reduce) {
  .pm-drift,
  .pm-spec { animation: none; }
  .prudent-svg animate { display: none; }
}
</style>
