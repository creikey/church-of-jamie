import { useEffect, useRef, useState } from 'react'
import type { Account, RequestCodeResponse, VerifyCodeResponse } from '../shared/api'
import { Turnstile } from './Turnstile.tsx'

/** Pulls the `error` field out of a failed endpoint, falling back to the status. */
async function errorFrom(response: Response): Promise<string> {
  const detail: unknown = await response.json().catch(() => null)
  if (typeof detail === 'object' && detail !== null && 'error' in detail) {
    return String((detail as { error: unknown }).error)
  }
  return `Something went wrong (HTTP ${response.status}).`
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) throw new Error(await errorFrom(response))
  return (await response.json()) as T
}

// ---------------------------------------------------------------- sign in

/**
 * Two steps in one panel: an address, then the six digits that were mailed to it. There is no
 * separate sign-up — the first correct code is what brings an account into existence.
 */
export function SignIn({
  dailyMessages,
  turnstileSiteKey,
  onSignedIn,
}: {
  dailyMessages: number
  turnstileSiteKey: string | null
  onSignedIn: (account: Account, created: boolean) => void
}) {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  // Bumped to remount the widget, which is how a spent single-use token gets replaced.
  const [challengeNonce, setChallengeNonce] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (sentTo) codeRef.current?.focus()
  }, [sentTo])

  const challengePending = turnstileSiteKey !== null && challengeToken === null

  const requestCode = async () => {
    if (busy || challengePending || !email.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await post<RequestCodeResponse>('/api/auth/request-code', {
        email,
        turnstileToken: challengeToken ?? undefined,
      })
      setSentTo(result.email)
    } catch (thrown: unknown) {
      setError(thrown instanceof Error ? thrown.message : 'Could not send the code.')
      // That token is spent whether or not the request succeeded, so start a fresh challenge.
      setChallengeToken(null)
      setChallengeNonce((current) => current + 1)
    } finally {
      setBusy(false)
    }
  }

  const verify = async (digits: string) => {
    if (busy || digits.length !== 6) return
    setBusy(true)
    setError(null)
    try {
      const result = await post<VerifyCodeResponse>('/api/auth/verify', { email: sentTo, code: digits })
      onSignedIn(result.account, result.created)
    } catch (thrown: unknown) {
      setError(thrown instanceof Error ? thrown.message : 'Could not sign you in.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-gild-dim/40 bg-ink/70 px-5 py-5">
      {sentTo === null ? (
        <>
          <p className="text-sm leading-relaxed text-muted">
            Leave your address to ask a question. Every address gets {dailyMessages} messages a day,
            free.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              autoComplete="email"
              value={email}
              disabled={busy}
              placeholder="you@example.com"
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void requestCode()
                }
              }}
              className="flex-1 rounded border border-gild-dim/40 bg-void/60 px-3 py-2 text-[0.95rem] text-vellum outline-none focus:border-gild/60 placeholder:text-muted/50 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void requestCode()}
              disabled={busy || challengePending || email.trim().length === 0}
              className="rounded border border-gild/50 px-4 py-2 text-[0.65rem] tracking-[0.24em] text-gild uppercase transition hover:bg-gild/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {busy ? 'Sending' : 'Send code'}
            </button>
          </div>

          {turnstileSiteKey && (
            <Turnstile
              key={challengeNonce}
              siteKey={turnstileSiteKey}
              onToken={setChallengeToken}
            />
          )}
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-muted">
            Six digits are on their way to <span className="text-vellum">{sentTo}</span>.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              disabled={busy}
              placeholder="000000"
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, '').slice(0, 6)
                setCode(digits)
                // Six digits can only mean one thing; asking for a second click is friction.
                if (digits.length === 6) void verify(digits)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void verify(code)
                }
              }}
              className="flex-1 rounded border border-gild-dim/40 bg-void/60 px-3 py-2 text-[0.95rem] tracking-[0.4em] text-vellum outline-none focus:border-gild/60 placeholder:text-muted/40 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void verify(code)}
              disabled={busy || code.length !== 6}
              className="rounded border border-gild/50 px-4 py-2 text-[0.65rem] tracking-[0.24em] text-gild uppercase transition hover:bg-gild/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {busy ? 'Opening' : 'Enter'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setSentTo(null)
              setCode('')
              setError(null)
              // Back at step one, and the token that got us here is already spent.
              setChallengeToken(null)
              setChallengeNonce((current) => current + 1)
            }}
            className="mt-3 text-[0.65rem] tracking-[0.24em] text-muted uppercase transition hover:text-gild"
          >
            Use another address
          </button>
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-300/80">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- account bar

export function AccountBar({
  account,
  dailyMessages,
  onSignedOut,
  onError,
}: {
  account: Account
  dailyMessages: number
  onSignedOut: () => void
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const signOut = async () => {
    if (busy) return
    setBusy(true)
    try {
      await post('/api/auth/logout')
      onSignedOut()
    } catch (thrown: unknown) {
      onError(thrown instanceof Error ? thrown.message : 'Could not sign you out.')
    } finally {
      setBusy(false)
    }
  }

  const deleteAccount = async () => {
    if (busy) return
    setBusy(true)
    try {
      const response = await fetch('/api/account', { method: 'DELETE' })
      if (!response.ok) throw new Error(await errorFrom(response))
      onSignedOut()
    } catch (thrown: unknown) {
      onError(thrown instanceof Error ? thrown.message : 'Could not delete the account.')
    } finally {
      setBusy(false)
      setConfirmingDelete(false)
    }
  }

  return (
    <div className="mt-8 border-t border-gild-dim/25 pt-3 text-[0.65rem] tracking-[0.18em] uppercase">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-muted">
          {account.email}
          <span className="text-gild-dim"> · </span>
          <span className={account.messagesRemainingToday > 0 ? 'text-gild' : 'text-red-300/80'}>
            {account.messagesRemainingToday} of {dailyMessages} left today
          </span>
        </span>

        <span className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={busy}
            className="tracking-[0.24em] text-muted transition hover:text-gild disabled:opacity-40"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete((current) => !current)}
            disabled={busy}
            className="tracking-[0.24em] text-muted/60 transition hover:text-red-300/80 disabled:opacity-40"
          >
            Delete
          </button>
        </span>
      </div>

      {confirmingDelete && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-red-400/25 px-3 py-2">
          <span className="w-full text-muted normal-case tracking-normal">
            Deleting erases the account. Whatever you have used of today's {dailyMessages} messages
            stays used — signing up again with this address does not start the day over.
          </span>
          <button
            type="button"
            onClick={() => void deleteAccount()}
            disabled={busy}
            className="tracking-[0.24em] text-red-300/80 transition hover:text-red-200 disabled:opacity-40"
          >
            Delete forever
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            disabled={busy}
            className="tracking-[0.24em] text-muted transition hover:text-gild disabled:opacity-40"
          >
            Keep it
          </button>
        </div>
      )}
    </div>
  )
}
