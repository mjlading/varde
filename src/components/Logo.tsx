/** Varde mark: a cairn of cut stone with the beacon lit and broadcasting.
 *  Half landmark, half transmitter — faceted slabs with vents, fire with
 *  signal. Static on purpose: it appears on splash and welcome, not as
 *  ambience. */
export function Logo({ size = 48 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 84" width={size} height={(size * 84) / 64} aria-hidden="true">
      {/* signal arc: the beacon transmitting */}
      <path
        d="M21.5 6 A 14.5 14.5 0 0 1 42.5 6"
        fill="none"
        stroke="var(--accent)"
        strokeOpacity="0.55"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* fire, hovering above the apex */}
      <path
        d="M32 10 C 27.5 15.5, 25.9 18.9, 27.3 22.1 C 28.3 24.4, 30.2 25.6, 32 25.6 C 33.8 25.6, 35.7 24.4, 36.7 22.1 C 38.1 18.9, 36.5 15.5, 32 10 Z"
        fill="var(--waking)"
      />
      <path
        d="M32 15.5 C 30 18, 29.4 19.6, 30.1 21.2 C 30.6 22.3, 31.2 22.8, 32 22.8 C 32.8 22.8, 33.4 22.3, 33.9 21.2 C 34.6 19.6, 34 18, 32 15.5 Z"
        fill="#ffe9c0"
      />

      {/* faceted slabs */}
      <path d="M12 76 L16 62 L50 63 L53 76 Z"
        fill="rgba(255,240,220,0.07)" stroke="rgba(255,240,220,0.42)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M36 62.5 L43 76" stroke="rgba(255,240,220,0.24)" strokeWidth="1.6" />
      <path d="M18 61 L22 49 L44 48 L47 61 Z"
        fill="rgba(255,240,220,0.06)" stroke="rgba(255,240,220,0.4)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M31 48.5 L28 61" stroke="rgba(255,240,220,0.22)" strokeWidth="1.6" />
      <path d="M32 30 C 26 33, 22.5 38.5, 22.5 43 C 22.5 46, 26 47.5, 32 47.5 C 38 47.5, 41.5 46, 41.5 43 C 41.5 38.5, 38 33, 32 30 Z"
        fill="rgba(255,240,220,0.07)" stroke="rgba(255,240,220,0.42)" strokeWidth="2" />

      {/* vents on the base slab */}
      <line x1="22" y1="68" x2="33" y2="68" stroke="rgba(255,240,220,0.3)" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="22" y1="71.5" x2="33" y2="71.5" stroke="rgba(255,240,220,0.3)" strokeWidth="1.6" strokeLinecap="round" />

      {/* ground */}
      <line x1="11" y1="79" x2="53" y2="79" stroke="rgba(255,240,220,0.2)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
