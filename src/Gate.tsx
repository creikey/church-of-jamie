import { useRef, useState } from 'react'
import type { ChallengeResponse } from '../shared/api'
import { Turnstile } from './Turnstile.tsx'

/** Pulls the `error` field out of a failed endpoint, falling back to the status. */
async function errorFrom(response: Response): Promise<string> {
  const detail: unknown = await response.json().catch(() => null)
  if (typeof detail === 'object' && detail !== null && 'error' in detail) {
    return String((detail as { error: unknown }).error)
  }
  return `Something went wrong (HTTP ${response.status}).`
}

// ---------------------------------------------------------------- the challenge

/**
 * What stands where a sign-in form used to. Solving the challenge is the whole of it: the token
 * goes straight to `/api/challenge`, which puts the messages on a cookie.
 *
 * The widget usually passes on its own, so the claim is sent the moment a token arrives rather
 * than waiting for a click that would have nothing to decide. Two things follow from that, and
 * both are why this is not simply `onToken={claim}`:
 *
 * - Exactly one claim per widget. Turnstile refreshes its own token before it expires, and every
 *   refresh calls back — without the latch, a panel left open would quietly claim again.
 * - A failure waits for a person. A token is single-use, so a fresh widget is the only way to try
 *   again; remounting one automatically would auto-solve, auto-claim, auto-fail, and hammer the
 *   endpoint for as long as the tab is open. The retry is a button on purpose.
 */
export function Challenge({
  messagesPerChallenge,
  turnstileSiteKey,
  spent,
  onGranted,
}: {
  messagesPerChallenge: number
  turnstileSiteKey: string | null
  /** True when this is a refill rather than a first visit, which is all the copy needs to know. */
  spent: boolean
  onGranted: (messagesRemaining: number) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped to remount the widget, which is how a spent single-use token gets replaced.
  const [nonce, setNonce] = useState(0)
  const claimed = useRef(false)

  const claim = async (turnstileToken?: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ turnstileToken }),
      })
      if (!response.ok) throw new Error(await errorFrom(response))
      const result = (await response.json()) as ChallengeResponse
      onGranted(result.messagesRemaining)
    } catch (thrown: unknown) {
      setError(thrown instanceof Error ? thrown.message : 'That did not go through.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-gild-dim/40 bg-ink/70 px-5 py-5">
      <p className="text-sm leading-relaxed text-muted">
        {spent
          ? `That is ${messagesPerChallenge} messages. Prove you are human again for ${messagesPerChallenge} more.`
          : `Prove you are human and ${messagesPerChallenge} messages are yours, free. Another ${messagesPerChallenge} whenever those run out.`}
      </p>

      {turnstileSiteKey && !error ? (
        <Turnstile
          key={nonce}
          siteKey={turnstileSiteKey}
          onToken={(token) => {
            if (!token || claimed.current) return
            claimed.current = true
            void claim(token)
          }}
        />
      ) : turnstileSiteKey ? (
        // The spent token cannot be retried, so the next attempt is a whole new widget.
        <button
          type="button"
          onClick={() => {
            claimed.current = false
            setError(null)
            setNonce((current) => current + 1)
          }}
          disabled={busy}
          className="mt-4 rounded border border-gild/50 px-4 py-2 text-[0.65rem] tracking-[0.24em] text-gild uppercase transition hover:bg-gild/10 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Try again
        </button>
      ) : (
        // No keys configured, so there is no challenge to pass — local development, or a
        // deployment with the hole left open. Something still has to ask for the messages.
        <button
          type="button"
          onClick={() => void claim()}
          disabled={busy}
          className="mt-4 rounded border border-gild/50 px-4 py-2 text-[0.65rem] tracking-[0.24em] text-gild uppercase transition hover:bg-gild/10 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {busy ? 'Opening' : 'Begin'}
        </button>
      )}

      {error && <p className="mt-3 text-sm text-red-300/80">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- what is left

export function Allowance({
  messagesRemaining,
  messagesPerChallenge,
}: {
  messagesRemaining: number
  messagesPerChallenge: number
}) {
  return (
    <div className="mt-8 border-t border-gild-dim/25 pt-3 text-[0.65rem] tracking-[0.18em] uppercase">
      <span className={messagesRemaining > 0 ? 'text-gild' : 'text-red-300/80'}>
        {messagesRemaining} of {messagesPerChallenge} messages left
      </span>
    </div>
  )
}
