import { useEffect, useRef } from 'react'

/**
 * The Cloudflare Turnstile widget, rendered explicitly so its lifetime is tied to the component.
 *
 * Tokens are single-use: once one has been spent on a request, the widget has to be reset before
 * it will hand out another. Rather than reach for `turnstile.reset`, the sign-in panel gives this
 * a changing `key`, which unmounts and remounts it — same effect, and no imperative handle.
 */

interface TurnstileApi {
  render(
    element: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
      theme?: 'light' | 'dark' | 'auto'
      size?: 'normal' | 'flexible' | 'compact'
    },
  ): string
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** Loaded once per page, however many times the widget mounts. */
let scriptPromise: Promise<void> | null = null

function loadTurnstile(): Promise<void> {
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_URL
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => {
        scriptPromise = null // a failed load must not poison every later attempt
        reject(new Error('Could not load the challenge.'))
      }
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

export function Turnstile({
  siteKey,
  onToken,
}: {
  siteKey: string
  /** Called with a fresh token, or null when it expires or the widget errors. */
  onToken: (token: string | null) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  // Held in a ref so a parent re-render cannot tear the widget down and rebuild it mid-challenge.
  const emit = useRef(onToken)
  emit.current = onToken

  useEffect(() => {
    let widgetId: string | undefined
    let cancelled = false

    void loadTurnstile()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          callback: (token) => emit.current(token),
          'expired-callback': () => emit.current(null),
          'error-callback': () => emit.current(null),
          theme: 'dark',
          size: 'flexible',
        })
      })
      .catch(() => {
        // Nothing to draw. The server still refuses the request, which is the right way round.
        if (!cancelled) emit.current(null)
      })

    return () => {
      cancelled = true
      if (widgetId) window.turnstile?.remove(widgetId)
    }
  }, [siteKey])

  return <div ref={container} className="mt-4" />
}
