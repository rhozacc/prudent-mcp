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
          Chrome looks "real" through three things working together:
            a) sharp narrow bright/dark BANDS (not smooth gradients)
            b) cool blue undertones in the shadows, slight cyan in the highs
            c) the bands SLIDE across the body as the form moves

          We use NO turbulence/displacement on the visible body — that's what
          was producing pixel-level jaggedness on the ribbon edges. All motion
          is via:
            • SMIL animate on the path's `d` (slow liquid bend)
            • animateTransform on gradient (bands raking across the surface)
            • CSS transforms on the group (slow ambient drift)
        -->

        <!--
          Chrome banding gradient. Direction is roughly perpendicular to the
          ribbon (top-right ↘ bottom-left). Sharp narrow whites separated by
          deep navies — the contrast is what reads as polished metal.
        -->
        <linearGradient id="pm-chrome" gradientUnits="userSpaceOnUse"
                        x1="1500" y1="100" x2="80" y2="1200">
          <stop offset="0%"   stop-color="#03061A"/>
          <stop offset="5%"   stop-color="#0A1240"/>
          <stop offset="11%"  stop-color="#1A2EA0"/>
          <stop offset="18%"  stop-color="#5C77FF"/>
          <stop offset="23%"  stop-color="#C7D2FF"/>
          <stop offset="26%"  stop-color="#FFFFFF"/>
          <stop offset="29%"  stop-color="#E2E8FF"/>
          <stop offset="34%"  stop-color="#7A93FF"/>
          <stop offset="42%"  stop-color="#2A45D8"/>
          <stop offset="50%"  stop-color="#0F1A6E"/>
          <stop offset="55%"  stop-color="#1E2EA8"/>
          <stop offset="62%"  stop-color="#8197FF"/>
          <stop offset="66%"  stop-color="#FFFFFF"/>
          <stop offset="70%"  stop-color="#A4B6FF"/>
          <stop offset="76%"  stop-color="#3A58FF"/>
          <stop offset="86%"  stop-color="#0F1A6E"/>
          <stop offset="94%"  stop-color="#0A1240"/>
          <stop offset="100%" stop-color="#03061A"/>
          <!-- Bands slide along the gradient axis over 56s — slow, hypnotic. -->
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            dur="56s"
            values="0 0; -160 80; 80 -40; 40 20; 0 0"
            repeatCount="indefinite"
            additive="sum"/>
        </linearGradient>

        <!--
          A second, narrower "reflection-map" gradient overlaid with screen
          blending — adds the hot environment-reflection bands that real
          chrome catches (the bright sky-reflection above + softer fill).
        -->
        <linearGradient id="pm-reflect" gradientUnits="userSpaceOnUse"
                        x1="1500" y1="100" x2="80" y2="1200">
          <stop offset="0%"   stop-color="#000000" stop-opacity="0"/>
          <stop offset="22%"  stop-color="#000000" stop-opacity="0"/>
          <stop offset="26%"  stop-color="#FFFFFF" stop-opacity="0.9"/>
          <stop offset="29%"  stop-color="#FFFFFF" stop-opacity="0.55"/>
          <stop offset="32%"  stop-color="#FFFFFF" stop-opacity="0"/>
          <stop offset="64%"  stop-color="#FFFFFF" stop-opacity="0"/>
          <stop offset="67%"  stop-color="#FFFFFF" stop-opacity="0.7"/>
          <stop offset="70%"  stop-color="#FFFFFF" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            dur="44s"
            values="0 0; -90 45; 45 -22; 0 0"
            repeatCount="indefinite"
            additive="sum"/>
        </linearGradient>

        <!-- Smooth Gaussian-blurred bloom; no displacement = no jaggedness. -->
        <filter id="pm-bloom-far" x="-30%" y="-30%" width="160%" height="160%"
                color-interpolation-filters="sRGB">
          <feGaussianBlur stdDeviation="110"/>
        </filter>
        <filter id="pm-bloom-near" x="-20%" y="-20%" width="140%" height="140%"
                color-interpolation-filters="sRGB">
          <feGaussianBlur stdDeviation="28"/>
        </filter>

        <!--
          The path itself MORPHS between three near-identical shapes via SMIL.
          This gives a genuine flowing-liquid bend without any noise-based
          displacement, so edges stay mathematically smooth.
        -->
        <path id="pm-stream"
              d="M 1700 60 C 1460 240, 1280 320, 1100 500 S 720 880, 480 1020 S 60 1240, -200 1320">
          <animate
            attributeName="d"
            dur="48s"
            repeatCount="indefinite"
            values="
              M 1700 60 C 1460 240, 1280 320, 1100 500 S 720 880, 480 1020 S 60 1240, -200 1320;
              M 1700 90 C 1440 200, 1260 360, 1080 480 S 700 900, 460 1040 S 40 1260, -220 1340;
              M 1700 40 C 1480 260, 1290 300, 1120 520 S 740 860, 500 1000 S 80 1220, -180 1300;
              M 1700 60 C 1460 240, 1280 320, 1100 500 S 720 880, 480 1020 S 60 1240, -200 1320"/>
        </path>

        <!-- Upper-offset path used for top-edge rim + spec band. The same SMIL
             d-morph is mirrored here so they stay in sync. -->
        <path id="pm-stream-rim"
              d="M 1700 28 C 1460 208, 1280 288, 1100 468 S 720 848, 480 988 S 60 1208, -200 1288">
          <animate
            attributeName="d"
            dur="48s"
            repeatCount="indefinite"
            values="
              M 1700 28 C 1460 208, 1280 288, 1100 468 S 720 848, 480 988 S 60 1208, -200 1288;
              M 1700 58 C 1440 168, 1260 328, 1080 448 S 700 868, 460 1008 S 40 1228, -220 1308;
              M 1700 8  C 1480 228, 1290 268, 1120 488 S 740 828, 500 968 S 80 1188, -180 1268;
              M 1700 28 C 1460 208, 1280 288, 1100 468 S 720 848, 480 988 S 60 1208, -200 1288"/>
        </path>

        <radialGradient id="pm-speck" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="1"/>
          <stop offset="30%"  stop-color="#E8ECFF" stop-opacity="0.6"/>
          <stop offset="70%"  stop-color="#5C77FF" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#3A58FF" stop-opacity="0"/>
        </radialGradient>
      </defs>

      <!-- ATMOSPHERIC BLOOM — pure blue haze extending the form softly. -->
      <use href="#pm-stream"
           stroke="#3A58FF"
           stroke-opacity="0.32"
           stroke-width="540"
           stroke-linecap="round"
           fill="none"
           filter="url(#pm-bloom-far)"/>

      <!-- INNER BLOOM — chrome gradient bloom, peaks white at center bands. -->
      <use href="#pm-stream"
           stroke="url(#pm-chrome)"
           stroke-opacity="0.7"
           stroke-width="320"
           stroke-linecap="round"
           fill="none"
           filter="url(#pm-bloom-near)"/>

      <g class="pm-drift" shape-rendering="geometricPrecision">

        <!-- MAIN BODY — the chrome banding. No displacement filter applied. -->
        <use href="#pm-stream"
             stroke="url(#pm-chrome)"
             stroke-width="220"
             stroke-linecap="round"
             fill="none"/>

        <!-- REFLECTION-MAP OVERLAY — narrow sharp highlight bands, screen
             blended so they only ADD light. -->
        <use href="#pm-stream"
             stroke="url(#pm-reflect)"
             stroke-width="220"
             stroke-linecap="round"
             fill="none"
             class="pm-reflect"/>

        <!-- TOP-EDGE SPEC BAND — broad anisotropic highlight on the upper
             offset path. Subtle (0.45 alpha), wide (60px), sliding slowly. -->
        <use href="#pm-stream-rim"
             stroke="#FFFFFF"
             stroke-opacity="0.42"
             stroke-width="60"
             stroke-linecap="round"
             fill="none"
             class="pm-spec-band"/>

        <!-- HAIR RIM — a 2px bright line on the upper silhouette and a
             matching 2px dark line on the lower silhouette. These edge
             contrasts are what most sell the metal as solid. -->
        <use href="#pm-stream-rim"
             stroke="#FFFFFF"
             stroke-opacity="0.85"
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

      <!-- TRAVELLING SPECKS — radial gradients drifting along the path
           direction. Screen-blended, slow, opacity-cycled. -->
      <g class="pm-specks">
        <circle cx="1180" cy="430" r="44" fill="url(#pm-speck)" class="pm-speck pm-speck-a"/>
        <circle cx="760"  cy="760" r="56" fill="url(#pm-speck)" class="pm-speck pm-speck-b"/>
        <circle cx="320"  cy="1020" r="40" fill="url(#pm-speck)" class="pm-speck pm-speck-c"/>
      </g>
    </svg>
  </div>
</template>

<style scoped>
/*
 * The bg lives inside .VPHero (via home-hero-before slot) but extends
 * DOWN past it into the .VPFeatures area so the metal sweeps across the
 * feature cards too. Its parent .VPHero gets overflow: visible (set
 * elsewhere in style.css), and .VPHome gets overflow: hidden so the
 * extra height is clipped at the page boundary.
 *
 * Mask: anchored upper-left, fades out before it ever reaches the
 * "Why this exists" section. Top-right is empty for the wordmark.
 */
.prudent-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  /* Extends past VPHero so the metal sweeps through VPFeatures too. */
  height: clamp(820px, 88vh, 1180px);
  pointer-events: none;
  z-index: 0;
  -webkit-mask-image:
    radial-gradient(
      ellipse 125% 80% at 18% 48%,
      black 0%,
      black 36%,
      rgba(0, 0, 0, 0.86) 52%,
      rgba(0, 0, 0, 0.42) 70%,
      rgba(0, 0, 0, 0.12) 84%,
      transparent 94%
    );
  mask-image:
    radial-gradient(
      ellipse 125% 80% at 18% 48%,
      black 0%,
      black 36%,
      rgba(0, 0, 0, 0.86) 52%,
      rgba(0, 0, 0, 0.42) 70%,
      rgba(0, 0, 0, 0.12) 84%,
      transparent 94%
    );
}
.prudent-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

/*
 * Slow ambient drift — 64s, ease-in-out. Subtle and meditative; previous
 * version moved twice as fast and felt restless.
 */
.pm-drift {
  transform-origin: 800px 600px;
  animation: pm-drift 64s ease-in-out infinite alternate;
  will-change: transform;
}
@keyframes pm-drift {
  0%   { transform: translate(0, 0)        rotate(-0.5deg) scale(1); }
  33%  { transform: translate(-14px, 8px)  rotate(0.4deg)  scale(1.012); }
  66%  { transform: translate(12px, -10px) rotate(-0.25deg) scale(0.994); }
  100% { transform: translate(-4px, 4px)   rotate(0.2deg)  scale(1.006); }
}

/* Reflection map breathes its opacity slowly — like environment light shifting. */
.pm-reflect {
  mix-blend-mode: screen;
  animation: pm-reflect 38s ease-in-out infinite alternate;
}
@keyframes pm-reflect {
  0%   { opacity: 0.6; }
  50%  { opacity: 0.95; }
  100% { transform: translate(8px, -4px); opacity: 0.75; }
}

/* Spec band slides slowly along the ribbon — was 13s, now 26s. */
.pm-spec-band {
  animation: pm-spec-band 26s ease-in-out infinite alternate;
}
@keyframes pm-spec-band {
  0%   { transform: translate(-28px, 16px); opacity: 0.35; }
  50%  { opacity: 0.7; }
  100% { transform: translate(30px, -18px); opacity: 0.5; }
}

/* Travelling specks — slowed to 28–36s and given longer fade-in/out. */
.pm-speck { mix-blend-mode: screen; }
.pm-speck-a { animation: pm-speck-a 32s ease-in-out infinite; }
.pm-speck-b { animation: pm-speck-b 36s ease-in-out infinite; }
.pm-speck-c { animation: pm-speck-c 28s ease-in-out infinite; }

@keyframes pm-speck-a {
  0%   { transform: translate(0, 0)          scale(0.7); opacity: 0; }
  25%  { opacity: 0.85; }
  65%  { transform: translate(-300px, 180px) scale(1.15); opacity: 0.65; }
  100% { transform: translate(-600px, 400px) scale(0.55); opacity: 0; }
}
@keyframes pm-speck-b {
  0%   { transform: translate(140px, -90px)  scale(0.5); opacity: 0; }
  30%  { opacity: 0.9; }
  75%  { transform: translate(-200px, 130px) scale(1.25); opacity: 0.55; }
  100% { transform: translate(-420px, 260px) scale(0.55); opacity: 0; }
}
@keyframes pm-speck-c {
  0%   { transform: translate(220px, -140px) scale(0.55); opacity: 0; }
  35%  { opacity: 0.8; }
  80%  { transform: translate(-100px, 70px)  scale(1.1); opacity: 0.45; }
  100% { transform: translate(-280px, 190px) scale(0.5); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .pm-drift,
  .pm-reflect,
  .pm-spec-band,
  .pm-speck-a,
  .pm-speck-b,
  .pm-speck-c { animation: none; }
  .prudent-svg animate,
  .prudent-svg animateTransform { display: none; }
}
</style>
