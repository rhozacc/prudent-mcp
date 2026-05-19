<template>
  <div class="prudent-bg" aria-hidden="true">
    <svg
      class="prudent-svg"
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMax slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <!--
          Chrome banding. A real polished-chrome reflection has at least two
          bright peaks (the environment above + a secondary fill) separated by
          darker bands. We tune the stops accordingly: two whites at 28% and
          62%, deep navy lows at 0/50/100, with cool-tinted transitions so
          the metal reads as a cold blue chrome rather than a flat blue.

          gradientUnits="userSpaceOnUse" + an animated translate on
          gradientTransform makes the bands slide *across* the ribbon over
          time — like light raking over the surface as it moves.
        -->
        <linearGradient id="pm-chrome" gradientUnits="userSpaceOnUse"
                        x1="1400" y1="180" x2="200" y2="920">
          <stop offset="0%"   stop-color="#070D33"/>
          <stop offset="7%"   stop-color="#16209A"/>
          <stop offset="17%"  stop-color="#5C77FF"/>
          <stop offset="25%"  stop-color="#C7D2FF"/>
          <stop offset="30%"  stop-color="#FFFFFF"/>
          <stop offset="36%"  stop-color="#C7D2FF"/>
          <stop offset="44%"  stop-color="#3A58FF"/>
          <stop offset="52%"  stop-color="#1E2EA8"/>
          <stop offset="60%"  stop-color="#8197FF"/>
          <stop offset="65%"  stop-color="#FFFFFF"/>
          <stop offset="70%"  stop-color="#8197FF"/>
          <stop offset="78%"  stop-color="#1E2EA8"/>
          <stop offset="88%"  stop-color="#3A58FF"/>
          <stop offset="100%" stop-color="#070D33"/>
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            dur="14s"
            values="0 0; -60 30; 30 -15; 0 0"
            repeatCount="indefinite"
            additive="sum"/>
        </linearGradient>

        <!-- Anisotropic micro-banding overlay: brushed-chrome texture. Mostly
             horizontal fine noise multiplied over the body adds the
             grain-of-the-metal credibility cue. -->
        <filter id="pm-aniso" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.18"
                        numOctaves="1" seed="3" result="grain"/>
          <feColorMatrix in="grain" type="matrix"
                         values="0 0 0 0 1
                                 0 0 0 0 1
                                 0 0 0 0 1
                                 0 0 0 0.12 0"/>
          <feComposite in2="SourceGraphic" operator="in"/>
        </filter>

        <!-- Two-stage flow. Macro: slow large-scale body deformation. Micro:
             fast small-scale surface ripple. Layering them gives the
             "flowing metal" feel rather than "wobbly jelly". -->
        <filter id="pm-macro" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.0042 0.010"
                        numOctaves="2" seed="11" result="bigNoise">
            <animate attributeName="baseFrequency" dur="34s"
                     values="0.0042 0.010; 0.0058 0.008; 0.0048 0.013; 0.0042 0.010"
                     repeatCount="indefinite"/>
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="bigNoise" scale="46">
            <animate attributeName="scale" dur="22s"
                     values="38; 62; 46; 38"
                     repeatCount="indefinite"/>
          </feDisplacementMap>
        </filter>

        <filter id="pm-micro" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.022 0.04"
                        numOctaves="2" seed="29" result="smNoise">
            <animate attributeName="baseFrequency" dur="9s"
                     values="0.022 0.04; 0.028 0.035; 0.020 0.045; 0.022 0.04"
                     repeatCount="indefinite"/>
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="smNoise" scale="7">
            <animate attributeName="scale" dur="7s"
                     values="5; 11; 7; 5"
                     repeatCount="indefinite"/>
          </feDisplacementMap>
          <feGaussianBlur stdDeviation="0.5"/>
        </filter>

        <!-- Big atmospheric bloom (blue) and a tighter hot-white bloom. -->
        <filter id="pm-bloom-atmos" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="90"/>
        </filter>
        <filter id="pm-bloom-core" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="22"/>
        </filter>

        <!--
          The path itself. An elegant S-curve: enters off the top-right edge,
          bends through the body of the hero, exits off the bottom-left.
          Defined once and reused for every layer so the geometry is locked.
        -->
        <path id="pm-stream"
              d="M 1740 60
                 C 1480 220, 1280 200, 1120 410
                 S 720 700, 500 820
                 S 60 1060, -200 1120"/>

        <!-- A path offset slightly upward of the main stream — used for the
             top-edge rim highlight and the broad anisotropic spec band so the
             brightest light reads as coming from above. -->
        <path id="pm-stream-upper"
              d="M 1740 26
                 C 1480 186, 1280 166, 1120 376
                 S 720 666, 500 786
                 S 60 1026, -200 1086"/>

        <!-- Radial gradients for the discrete hot-spec "specks" that ride
             along the ribbon. -->
        <radialGradient id="pm-speck" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="1"/>
          <stop offset="35%"  stop-color="#E8ECFF" stop-opacity="0.55"/>
          <stop offset="70%"  stop-color="#5C77FF" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#3A58FF" stop-opacity="0"/>
        </radialGradient>
      </defs>

      <g class="pm-drift">
        <!-- 1. Atmospheric bloom: very wide soft blue haze that extends the
                form past any visible edge. Pure blue, low opacity. -->
        <use href="#pm-stream"
             stroke="#3A58FF"
             stroke-opacity="0.42"
             stroke-width="460"
             stroke-linecap="round"
             fill="none"
             filter="url(#pm-bloom-atmos)"/>

        <!-- 2. Hot core bloom: tighter, brighter, pulled toward white at the
                center bands. This is what gives the "glowing wet metal" feel. -->
        <use href="#pm-stream"
             stroke="url(#pm-chrome)"
             stroke-opacity="0.85"
             stroke-width="300"
             stroke-linecap="round"
             fill="none"
             filter="url(#pm-bloom-core)"/>

        <!-- 3. Main chrome body. Two stacked displacement filters apply:
                macro for body flow, micro for surface ripple. -->
        <g filter="url(#pm-micro)">
          <g filter="url(#pm-macro)">
            <use href="#pm-stream"
                 stroke="url(#pm-chrome)"
                 stroke-width="210"
                 stroke-linecap="round"
                 fill="none"/>

            <!-- 4. Broad anisotropic spec band — wider than a hairline, sits
                    on the upper side of the ribbon. White → blue → transparent
                    so it falls off naturally instead of cutting. -->
            <use href="#pm-stream-upper"
                 class="pm-spec-band"
                 stroke="#FFFFFF"
                 stroke-opacity="0.7"
                 stroke-width="46"
                 stroke-linecap="round"
                 fill="none"/>

            <!-- 5. Rim highlight: thin bright edge along the upper silhouette
                    where the surface tangent goes vertical. -->
            <use href="#pm-stream-upper"
                 stroke="#E8ECFF"
                 stroke-opacity="0.55"
                 stroke-width="3"
                 stroke-linecap="round"
                 fill="none"/>
          </g>
        </g>

        <!-- 6. Discrete hot-specks travelling along the ribbon. Three offset
                circles painted with the speck radial gradient; CSS animation
                slides them along the path direction so highlights look like
                they're flowing with the metal. -->
        <g class="pm-specks">
          <circle cx="1180" cy="380" r="34" fill="url(#pm-speck)" class="pm-speck pm-speck-a"/>
          <circle cx="780"  cy="660" r="44" fill="url(#pm-speck)" class="pm-speck pm-speck-b"/>
          <circle cx="320"  cy="900" r="38" fill="url(#pm-speck)" class="pm-speck pm-speck-c"/>
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
/*
 * Full-bleed behind the hero. Mask is a smooth radial that fades fully
 * transparent before reaching any rectangle boundary — there are no hard
 * edges anywhere in this composition.
 */
.prudent-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
  -webkit-mask-image:
    radial-gradient(
      ellipse 135% 115% at 16% 96%,
      black 0%,
      black 36%,
      rgba(0, 0, 0, 0.88) 50%,
      rgba(0, 0, 0, 0.45) 68%,
      rgba(0, 0, 0, 0.12) 82%,
      transparent 92%
    );
  mask-image:
    radial-gradient(
      ellipse 135% 115% at 16% 96%,
      black 0%,
      black 36%,
      rgba(0, 0, 0, 0.88) 50%,
      rgba(0, 0, 0, 0.45) 68%,
      rgba(0, 0, 0, 0.12) 82%,
      transparent 92%
    );
}
.prudent-svg {
  position: absolute;
  inset: -12% -6% -12% -6%;
  width: 112%;
  height: 124%;
  display: block;
}

/*
 * Two timescales of ambient motion so the form is always moving without
 * ever looping visibly. The displacement filters move on independent
 * cycles already; these CSS animations add bulk drift + spec sliding.
 */
.pm-drift {
  transform-origin: 800px 600px;
  animation: pm-drift 38s ease-in-out infinite alternate;
  will-change: transform;
}
@keyframes pm-drift {
  0%   { transform: translate(0, 0)        rotate(-0.8deg) scale(1); }
  33%  { transform: translate(-22px, 10px) rotate(0.6deg)  scale(1.018); }
  66%  { transform: translate(18px, -12px) rotate(-0.4deg) scale(0.992); }
  100% { transform: translate(-8px, 6px)   rotate(0.3deg)  scale(1.008); }
}

/*
 * Broad spec band slides slowly along the ribbon, opacity breathing so
 * the highlight feels alive rather than scripted.
 */
.pm-spec-band {
  animation: pm-spec-band 13s ease-in-out infinite alternate;
}
@keyframes pm-spec-band {
  0%   { transform: translate(-32px, 20px); opacity: 0.45; }
  50%  { opacity: 0.85; }
  100% { transform: translate(34px, -18px); opacity: 0.6; }
}

/*
 * The three "specks" drift along the path direction at different rates,
 * giving the impression of light catching on flowing metal. Each on its
 * own offset cycle.
 */
.pm-speck { mix-blend-mode: screen; }
.pm-speck-a { animation: pm-speck-a 17s ease-in-out infinite; }
.pm-speck-b { animation: pm-speck-b 21s ease-in-out infinite; }
.pm-speck-c { animation: pm-speck-c 19s ease-in-out infinite; }

@keyframes pm-speck-a {
  0%   { transform: translate(0, 0)         scale(0.7); opacity: 0; }
  20%  { opacity: 1; }
  60%  { transform: translate(-260px, 160px) scale(1.2); opacity: 0.9; }
  100% { transform: translate(-540px, 360px) scale(0.6); opacity: 0; }
}
@keyframes pm-speck-b {
  0%   { transform: translate(120px, -80px)  scale(0.5); opacity: 0; }
  25%  { opacity: 0.95; }
  70%  { transform: translate(-180px, 120px) scale(1.3); opacity: 0.7; }
  100% { transform: translate(-380px, 240px) scale(0.6); opacity: 0; }
}
@keyframes pm-speck-c {
  0%   { transform: translate(200px, -120px) scale(0.6); opacity: 0; }
  30%  { opacity: 0.85; }
  75%  { transform: translate(-80px, 60px)   scale(1.1); opacity: 0.5; }
  100% { transform: translate(-240px, 160px) scale(0.5); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .pm-drift,
  .pm-spec-band,
  .pm-speck-a,
  .pm-speck-b,
  .pm-speck-c { animation: none; }
  .prudent-svg animate,
  .prudent-svg animateTransform { display: none; }
}
</style>
