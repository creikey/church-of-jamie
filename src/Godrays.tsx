/**
 * Light shafts falling from above the halo.
 *
 * Every ray is a plain gradient — softness comes from the gradient and the mask, not from a
 * `filter: blur`, which would re-rasterize each frame. Only `transform` and `opacity` animate,
 * so the whole effect stays on the compositor and costs no layout or paint work per frame.
 */

interface Ray {
  angle: number
  width: number
  duration: number
  delay: number
}

const RAYS: Ray[] = [
  { angle: -34, width: 0.42, duration: 19, delay: -2 },
  { angle: -21, width: 0.7, duration: 26, delay: -11 },
  { angle: -11, width: 0.34, duration: 15, delay: -6 },
  { angle: -3, width: 0.9, duration: 31, delay: -18 },
  { angle: 8, width: 0.4, duration: 17, delay: -9 },
  { angle: 17, width: 0.62, duration: 23, delay: -4 },
  { angle: 29, width: 0.36, duration: 21, delay: -14 },
  { angle: 39, width: 0.5, duration: 28, delay: -21 },
]

export function Godrays() {
  return (
    <div className="godrays" aria-hidden="true">
      {RAYS.map((ray) => (
        <div
          key={ray.angle}
          className="ray-shaft"
          style={{ transform: `rotate(${ray.angle}deg)` }}
        >
          <div
            className="ray"
            style={{
              '--ray-width': ray.width,
              animationDuration: `${ray.duration}s`,
              animationDelay: `${ray.delay}s`,
            } as React.CSSProperties}
          />
        </div>
      ))}
    </div>
  )
}
