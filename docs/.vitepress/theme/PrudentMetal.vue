<template>
  <div class="prudent-bg" aria-hidden="true">
    <svg
      class="prudent-svg"
      viewBox="0 0 1600 1200"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <!--
          PlayStation-Home-grade chrome: glossy, glassy, high-bloom, slightly
          iridescent. Same path-morph motion engine (smooth, no displacement),
          but with brighter highlights, more bloom layers, and added halo.
        -->

        <linearGradient id="pm-chrome" gradientUnits="userSpaceOnUse"
                        x1="1500" y1="100" x2="80" y2="1200">
          <stop offset="0%"   stop-color="#03061A"/>
          <stop offset="5%"   stop-color="#0A1240"/>
          <stop offset="11%"  stop-color="#1A2EA0"/>
          <stop offset="17%"  stop-color="#5C77FF"/>
          <stop offset="22%"  stop-color="#BDD3FF"/>
          <stop offset="25%"  stop-color="#FFFFFF"/>
          <stop offset="28%"  stop-color="#E8F2FF"/>
          <stop offset="33%"  stop-color="#88A8FF"/>
          <stop offset="42%"  stop-color="#2A45D8"/>
          <stop offset="50%"  stop-color="#0F1A6E"/>
          <stop offset="55%"  stop-color="#1E2EA8"/>
          <stop offset="61%"  stop-color="#8FB0FF"/>
          <stop offset="65%"  stop-color="#FFFFFF"/>
          <stop offset="69%"  stop-color="#C5D6FF"/>
          <stop offset="76%"  stop-color="#3A58FF"/>
          <stop offset="86%"  stop-color="#0F1A6E"/>
          <stop offset="94%"  stop-color="#0A1240"/>
          <stop offset="100%" stop-color="#03061A"/>
          <!-- Bands slide ~2× faster now: 28s (was 56s). -->
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            dur="28s"
            values="0 0; -160 80; 80 -40; 40 20; 0 0"
            repeatCount="indefinite"
            additive="sum"/>
        </linearGradient>

        <linearGradient id="pm-reflect" gradientUnits="userSpaceOnUse"
                        x1="1500" y1="100" x2="80" y2="1200">
          <stop offset="0%"   stop-color="#000000" stop-opacity="0"/>
          <stop offset="21%"  stop-color="#000000" stop-opacity="0"/>
          <stop offset="25%"  stop-color="#FFFFFF" stop-opacity="1"/>
          <stop offset="28%"  stop-color="#E8F2FF" stop-opacity="0.7"/>
          <stop offset="32%"  stop-color="#FFFFFF" stop-opacity="0"/>
          <stop offset="63%"  stop-color="#FFFFFF" stop-opacity="0"/>
          <stop offset="66%"  stop-color="#FFFFFF" stop-opacity="0.9"/>
          <stop offset="70%"  stop-color="#FFFFFF" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            dur="22s"
            values="0 0; -90 45; 45 -22; 0 0"
            repeatCount="indefinite"
            additive="sum"/>
        </linearGradient>

        <!-- A subtle iridescent tint that drifts color slightly along the
             ribbon, like prismatic refraction. Multiplied very lightly. -->
        <linearGradient id="pm-irid" gradientUnits="userSpaceOnUse"
                        x1="1500" y1="100" x2="80" y2="1200">
          <stop offset="0%"   stop-color="#7A93FF" stop-opacity="0"/>
          <stop offset="35%"  stop-color="#9FCBFF" stop-opacity="0.18"/>
          <stop offset="55%"  stop-color="#C29DFF" stop-opacity="0.10"/>
          <stop offset="75%"  stop-color="#7DC8FF" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="#7A93FF" stop-opacity="0"/>
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            dur="34s"
            values="0 0; -80 40; 40 -20; 0 0"
            repeatCount="indefinite"
            additive="sum"/>
        </linearGradient>

        <!-- Three bloom radii: halo (huge soft glow that bridges the mask edge),
             far (atmospheric blue), near (hot core). -->
        <filter id="pm-bloom-halo" x="-40%" y="-40%" width="180%" height="180%"
                color-interpolation-filters="sRGB">
          <feGaussianBlur stdDeviation="180"/>
        </filter>
        <filter id="pm-bloom-far" x="-30%" y="-30%" width="160%" height="160%"
                color-interpolation-filters="sRGB">
          <feGaussianBlur stdDeviation="130"/>
        </filter>
        <filter id="pm-bloom-near" x="-20%" y="-20%" width="140%" height="140%"
                color-interpolation-filters="sRGB">
          <feGaussianBlur stdDeviation="34"/>
        </filter>

        <!--
          Path morphs between three near-identical S-curves. SMIL `d` animate
          — pure math, no noise filters. Now 2× faster: 24s (was 48s).
        -->
        <path id="pm-stream"
              d="M 1700 60 C 1460 240, 1280 320, 1100 500 S 720 880, 480 1020 S 60 1240, -200 1320">
          <animate
            attributeName="d"
            dur="24s"
            repeatCount="indefinite"
            values="
              M 1700 60 C 1460 240, 1280 320, 1100 500 S 720 880, 480 1020 S 60 1240, -200 1320;
              M 1700 90 C 1440 200, 1260 360, 1080 480 S 700 900, 460 1040 S 40 1260, -220 1340;
              M 1700 40 C 1480 260, 1290 300, 1120 520 S 740 860, 500 1000 S 80 1220, -180 1300;
              M 1700 60 C 1460 240, 1280 320, 1100 500 S 720 880, 480 1020 S 60 1240, -200 1320"/>
        </path>

        <path id="pm-stream-rim"
              d="M 1700 28 C 1460 208, 1280 288, 1100 468 S 720 848, 480 988 S 60 1208, -200 1288">
          <animate
            attributeName="d"
            dur="24s"
            repeatCount="indefinite"
            values="
              M 1700 28 C 1460 208, 1280 288, 1100 468 S 720 848, 480 988 S 60 1208, -200 1288;
              M 1700 58 C 1440 168, 1260 328, 1080 448 S 700 868, 460 1008 S 40 1228, -220 1308;
              M 1700 8  C 1480 228, 1290 268, 1120 488 S 740 828, 500 968 S 80 1188, -180 1268;
              M 1700 28 C 1460 208, 1280 288, 1100 468 S 720 848, 480 988 S 60 1208, -200 1288"/>
        </path>

        <radialGradient id="pm-speck" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="1"/>
          <stop offset="25%"  stop-color="#E8F2FF" stop-opacity="0.75"/>
          <stop offset="60%"  stop-color="#7DC8FF" stop-opacity="0.2"/>
          <stop offset="100%" stop-color="#3A58FF" stop-opacity="0"/>
        </radialGradient>
      </defs>

      <!-- HALO — huge soft white glow that bridges/bleeds into the mask edge,
           so the mask boundary itself dissolves into bloom rather than hard
           gradient termination. screen-blended for additive shine. -->
      <use href="#pm-stream"
           stroke="#9FBCFF"
           stroke-opacity="0.45"
           stroke-width="700"
           stroke-linecap="round"
           fill="none"
           filter="url(#pm-bloom-halo)"
           class="pm-halo"/>

      <!-- ATMOSPHERIC bloom — Prudent Blue haze. -->
      <use href="#pm-stream"
           stroke="#3A58FF"
           stroke-opacity="0.5"
           stroke-width="540"
           stroke-linecap="round"
           fill="none"
           filter="url(#pm-bloom-far)"/>

      <!-- HOT CORE bloom — chrome gradient bloom, peaks white. -->
      <use href="#pm-stream"
           stroke="url(#pm-chrome)"
           stroke-opacity="0.85"
           stroke-width="320"
           stroke-linecap="round"
           fill="none"
           filter="url(#pm-bloom-near)"
           class="pm-core"/>

      <g class="pm-drift" shape-rendering="geometricPrecision">

        <!-- MAIN BODY — chrome banding. -->
        <use href="#pm-stream"
             stroke="url(#pm-chrome)"
             stroke-width="220"
             stroke-linecap="round"
             fill="none"/>

        <!-- IRIDESCENT TINT — multiplied light hue-shift, very subtle. -->
        <use href="#pm-stream"
             stroke="url(#pm-irid)"
             stroke-width="220"
             stroke-linecap="round"
             fill="none"
             class="pm-irid"/>

        <!-- REFLECTION-MAP overlay — narrow sharp white spikes, screen blend. -->
        <use href="#pm-stream"
             stroke="url(#pm-reflect)"
             stroke-width="220"
             stroke-linecap="round"
             fill="none"
             class="pm-reflect"/>

        <!-- TOP-EDGE SPEC BAND — broad anisotropic highlight. -->
        <use href="#pm-stream-rim"
             stroke="#FFFFFF"
             stroke-opacity="0.55"
             stroke-width="60"
             stroke-linecap="round"
             fill="none"
             class="pm-spec-band"/>

        <!-- Hairline rims for solidity. -->
        <use href="#pm-stream-rim"
             stroke="#FFFFFF"
             stroke-opacity="0.95"
             stroke-width="2"
             stroke-linecap="round"
             fill="none"
             transform="translate(0,-1)"/>
        <use href="#pm-stream"
             stroke="#06091F"
             stroke-opacity="0.55"
             stroke-width="3"
             stroke-linecap="round"
             fill="none"
             transform="translate(0,110)"/>
      </g>

      <g class="pm-specks">
        <circle cx="1180" cy="430" r="48" fill="url(#pm-speck)" class="pm-speck pm-speck-a"/>
        <circle cx="760"  cy="760" r="62" fill="url(#pm-speck)" class="pm-speck pm-speck-b"/>
        <circle cx="320"  cy="1020" r="44" fill="url(#pm-speck)" class="pm-speck pm-speck-c"/>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.prudent-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: clamp(560px, 62vh, 820px);
  pointer-events: none;
  z-index: 0;

  /* Two intersected masks. Both must be opaque for a pixel to show. */
  -webkit-mask-image:
    radial-gradient(
      ellipse 105% 78% at 20% 42%,
      black 0%,
      rgba(0, 0, 0, 0.95) 18%,
      rgba(0, 0, 0, 0.78) 36%,
      rgba(0, 0, 0, 0.5) 54%,
      rgba(0, 0, 0, 0.22) 72%,
      rgba(0, 0, 0, 0.06) 84%,
      transparent 92%
    ),
    linear-gradient(
      to bottom,
      black 0%,
      black 38%,
      rgba(0, 0, 0, 0.85) 55%,
      rgba(0, 0, 0, 0.45) 72%,
      rgba(0, 0, 0, 0.15) 86%,
      transparent 96%
    );
  -webkit-mask-composite: source-in;
          mask-image:
    radial-gradient(
      ellipse 105% 78% at 20% 42%,
      black 0%,
      rgba(0, 0, 0, 0.95) 18%,
      rgba(0, 0, 0, 0.78) 36%,
      rgba(0, 0, 0, 0.5) 54%,
      rgba(0, 0, 0, 0.22) 72%,
      rgba(0, 0, 0, 0.06) 84%,
      transparent 92%
    ),
    linear-gradient(
      to bottom,
      black 0%,
      black 38%,
      rgba(0, 0, 0, 0.85) 55%,
      rgba(0, 0, 0, 0.45) 72%,
      rgba(0, 0, 0, 0.15) 86%,
      transparent 96%
    );
          mask-composite: intersect;
}

/*
 * Edge-softening blur: a slight Gaussian blur on the whole SVG smooths
 * the mask-boundary transition itself, so where the metal fades to
 * transparent there's no perceptible gradient banding — it dissolves.
 * Saturation + brightness bumps give the PlayStation-Home glassy gloss.
 */
.prudent-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  filter: blur(0.6px) saturate(1.18) brightness(1.06) contrast(1.04);
}

/* Halo and core breathe so the bloom has its own rhythm separate from the
 * geometry — makes the whole composition feel lit, not painted. */
.pm-halo {
  mix-blend-mode: screen;
  animation: pm-halo 16s ease-in-out infinite alternate;
  transform-origin: 800px 600px;
}
@keyframes pm-halo {
  0%   { opacity: 0.55; transform: scale(1); }
  100% { opacity: 0.95; transform: scale(1.04); }
}
.pm-core {
  mix-blend-mode: screen;
  animation: pm-core 14s ease-in-out infinite alternate;
}
@keyframes pm-core {
  0%   { opacity: 0.7; }
  100% { opacity: 1; }
}

/* Ambient drift — half the previous duration so it moves more visibly. */
.pm-drift {
  transform-origin: 800px 600px;
  animation: pm-drift 32s ease-in-out infinite alternate;
  will-change: transform;
}
@keyframes pm-drift {
  0%   { transform: translate(0, 0)        rotate(-0.5deg) scale(1); }
  33%  { transform: translate(-14px, 8px)  rotate(0.4deg)  scale(1.012); }
  66%  { transform: translate(12px, -10px) rotate(-0.25deg) scale(0.994); }
  100% { transform: translate(-4px, 4px)   rotate(0.2deg)  scale(1.006); }
}

.pm-irid {
  mix-blend-mode: overlay;
  animation: pm-irid 24s ease-in-out infinite alternate;
}
@keyframes pm-irid {
  0%   { opacity: 0.4; }
  100% { opacity: 0.85; }
}

.pm-reflect {
  mix-blend-mode: screen;
  animation: pm-reflect 19s ease-in-out infinite alternate;
}
@keyframes pm-reflect {
  0%   { opacity: 0.65; }
  50%  { opacity: 1; }
  100% { transform: translate(8px, -4px); opacity: 0.8; }
}

.pm-spec-band {
  mix-blend-mode: screen;
  animation: pm-spec-band 13s ease-in-out infinite alternate;
}
@keyframes pm-spec-band {
  0%   { transform: translate(-28px, 16px); opacity: 0.4; }
  50%  { opacity: 0.8; }
  100% { transform: translate(30px, -18px); opacity: 0.55; }
}

/* Specks halved: was 28–36s, now 14–18s. */
.pm-speck { mix-blend-mode: screen; }
.pm-speck-a { animation: pm-speck-a 16s ease-in-out infinite; }
.pm-speck-b { animation: pm-speck-b 18s ease-in-out infinite; }
.pm-speck-c { animation: pm-speck-c 14s ease-in-out infinite; }

@keyframes pm-speck-a {
  0%   { transform: translate(0, 0)          scale(0.7); opacity: 0; }
  25%  { opacity: 0.95; }
  65%  { transform: translate(-300px, 180px) scale(1.2); opacity: 0.75; }
  100% { transform: translate(-600px, 400px) scale(0.55); opacity: 0; }
}
@keyframes pm-speck-b {
  0%   { transform: translate(140px, -90px)  scale(0.5); opacity: 0; }
  30%  { opacity: 1; }
  75%  { transform: translate(-200px, 130px) scale(1.3); opacity: 0.65; }
  100% { transform: translate(-420px, 260px) scale(0.55); opacity: 0; }
}
@keyframes pm-speck-c {
  0%   { transform: translate(220px, -140px) scale(0.55); opacity: 0; }
  35%  { opacity: 0.9; }
  80%  { transform: translate(-100px, 70px)  scale(1.15); opacity: 0.55; }
  100% { transform: translate(-280px, 190px) scale(0.5); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .pm-drift,
  .pm-halo,
  .pm-core,
  .pm-irid,
  .pm-reflect,
  .pm-spec-band,
  .pm-speck-a,
  .pm-speck-b,
  .pm-speck-c { animation: none; }
  .prudent-svg animate,
  .prudent-svg animateTransform { display: none; }
}
</style>
