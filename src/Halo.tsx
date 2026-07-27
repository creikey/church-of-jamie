/**
 * The reliquary halo. With no portrait behind it this is the whole icon, so it is drawn as a
 * rosette: a flower-of-life core, banded rings, and two counter-rotating outer rings.
 */

const ROSETTE = Array.from({ length: 12 }, (_, i) => {
  const angle = (i * Math.PI * 2) / 12
  return { cx: 200 + Math.cos(angle) * 44, cy: 200 + Math.sin(angle) * 44 }
})

const SPOKES = Array.from({ length: 24 }, (_, i) => i * 15)

export function Halo({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 400 400"
      aria-hidden="true"
      className={`absolute inset-0 h-full w-full ${active ? 'contemplating' : ''}`}
    >
      <defs>
        <radialGradient id="halo-core">
          <stop offset="0%" stopColor="var(--color-gild)" stopOpacity="0.5" />
          <stop offset="40%" stopColor="var(--color-gild)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--color-gild)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="200" cy="200" r="196" fill="url(#halo-core)" />

      {/* Flower-of-life core */}
      <g stroke="var(--color-gild)" fill="none">
        {ROSETTE.map((petal, i) => (
          <circle key={i} cx={petal.cx} cy={petal.cy} r="44" strokeOpacity="0.16" />
        ))}
        <circle cx="200" cy="200" r="44" strokeOpacity="0.34" />
        <circle cx="200" cy="200" r="88" strokeOpacity="0.42" />
        <circle cx="200" cy="200" r="94" strokeOpacity="0.16" />
      </g>

      {/* Fixed banding between core and rim */}
      <g stroke="var(--color-gild)" fill="none">
        <circle cx="200" cy="200" r="128" strokeOpacity="0.3" />
        <circle cx="200" cy="200" r="132" strokeOpacity="0.12" />
        {SPOKES.map((angle) => (
          <line
            key={angle}
            x1="200"
            y1="100"
            x2="200"
            y2="112"
            stroke="var(--color-gild)"
            strokeOpacity="0.28"
            transform={`rotate(${angle} 200 200)`}
          />
        ))}
      </g>

      <g className="halo-slow">
        <circle
          cx="200"
          cy="200"
          r="160"
          fill="none"
          stroke="var(--color-gild)"
          strokeOpacity="0.45"
          strokeWidth="1.5"
          strokeDasharray="1 13"
          strokeLinecap="round"
        />
      </g>

      <g className="halo-slower">
        <circle
          cx="200"
          cy="200"
          r="182"
          fill="none"
          stroke="var(--color-gild)"
          strokeOpacity="0.24"
          strokeDasharray="30 38"
        />
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <g key={angle} transform={`rotate(${angle} 200 200)`}>
            <line x1="200" y1="12" x2="200" y2="30" stroke="var(--color-gild)" strokeOpacity="0.55" />
            <circle cx="200" cy="36" r="1.8" fill="var(--color-gild)" fillOpacity="0.6" />
          </g>
        ))}
      </g>
    </svg>
  )
}
