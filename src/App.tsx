import { useCallback, useEffect, useRef, useState } from 'react'
import type { AskEvent, ChatMessage, MeResponse } from '../shared/api'
import { Allowance, Challenge } from './Gate.tsx'
import { Godrays } from './Godrays.tsx'
import { Halo } from './Halo.tsx'

const STORAGE_KEY = 'church-of-jamie:conversation'

/** Until `/api/me` answers, the allowance is unknown; this is only what the copy says meanwhile. */
const DEFAULT_MESSAGES_PER_CHALLENGE = 10

function loadConversation(): ChatMessage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is ChatMessage =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as ChatMessage).text === 'string' &&
        ((entry as ChatMessage).role === 'seeker' || (entry as ChatMessage).role === 'jamie'),
    )
  } catch {
    return []
  }
}

/** Reads the SSE body a chunk at a time, handing back each complete `data:` frame. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AskEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary).trim()
      buffer = buffer.slice(boundary + 2)
      if (frame.startsWith('data:')) {
        try {
          yield JSON.parse(frame.slice(5).trim()) as AskEvent
        } catch {
          // a malformed frame is not worth tearing the stream down for
        }
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadConversation)
  const [draft, setDraft] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [messagesPerChallenge, setMessagesPerChallenge] = useState(DEFAULT_MESSAGES_PER_CHALLENGE)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const settled = useRef(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  }, [messages])

  const loadAllowance = useCallback(async (): Promise<void> => {
    const response = await fetch('/api/me')
    if (!response.ok) return
    const body = (await response.json()) as MeResponse
    setRemaining(body.messagesRemaining)
    setMessagesPerChallenge(body.messagesPerChallenge)
    setTurnstileSiteKey(body.turnstileSiteKey)
  }, [])

  // How many messages this browser has left, and whether there is a challenge in front of more.
  useEffect(() => {
    void (async () => {
      try {
        await loadAllowance()
      } catch {
        // Nothing to say yet — the challenge is the right thing to show either way.
      }
      setReady(true)
    })()
  }, [loadAllowance])

  // Scroll only on the two moments the reader initiated: arriving, and asking. An answer
  // streaming in never moves the page — you keep your place and read at your own pace.
  useEffect(() => {
    const arriving = !settled.current
    settled.current = true
    if (!arriving && messages[messages.length - 1]?.role !== 'seeker') return

    requestAnimationFrame(() => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: arriving ? 'auto' : 'smooth',
      })
    })
  }, [messages])

  const ask = async () => {
    const question = draft.trim()
    if (!question || asking || remaining <= 0) return

    const history = messages
    setMessages([...history, { role: 'seeker', text: question }])
    setDraft('')
    setError(null)
    setNotice(null)
    setAnswer('')
    setAsking(true)

    let spoken = ''
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, history }),
      })

      if (!response.ok || !response.body) {
        // 401 means the grant went away underneath us, 429 that it is spent. Either way the
        // challenge belongs back in the footer rather than a composer that cannot work.
        if (response.status === 401 || response.status === 429) setRemaining(0)

        const detail: unknown = await response.json().catch(() => null)
        const message =
          typeof detail === 'object' && detail !== null && 'error' in detail
            ? String((detail as { error: unknown }).error)
            : `The line went quiet (HTTP ${response.status}).`
        throw new Error(message)
      }

      for await (const event of readEvents(response.body)) {
        if (event.type === 'text') {
          spoken += event.text
          setAnswer(spoken)
        } else if (event.type === 'balance') {
          setRemaining(event.remaining)
        } else if (event.type === 'error') {
          throw new Error(event.message)
        }
      }

      if (!spoken.trim()) throw new Error('He said nothing at all. Try again.')
      setMessages((current) => [...current, { role: 'jamie', text: spoken.trim() }])
    } catch (thrown: unknown) {
      // Keep whatever he managed to say before the stream broke.
      if (spoken.trim()) {
        setMessages((current) => [...current, { role: 'jamie', text: spoken.trim() }])
      }
      setError(thrown instanceof Error ? thrown.message : 'Something went wrong.')
    } finally {
      setAnswer(null)
      setAsking(false)
    }
  }

  const startOver = () => {
    setMessages([])
    setAnswer(null)
    setError(null)
    setDraft('')
    inputRef.current?.focus()
  }

  return (
    <div className="nave relative flex min-h-full flex-col">
      <Godrays />
      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-6 pt-10 sm:pt-16">
        <header className="flex flex-col items-center text-center">
          <div className="relative h-52 w-52 sm:h-64 sm:w-64">
            <Halo active={asking} />
          </div>

          <h1 className="mt-6 text-[0.7rem] tracking-[0.42em] text-gild uppercase">
            The Church of Jamie
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Ask Jamie <span className="text-muted/60">(This is an AI)</span>
          </p>
        </header>

        {ready && remaining > 0 && (
          <Allowance messagesRemaining={remaining} messagesPerChallenge={messagesPerChallenge} />
        )}

        <main className="mt-10 flex-1 space-y-8">
          {messages.map((message, index) =>
            message.role === 'seeker' ? (
              <p
                key={index}
                className="border-l border-gild-dim/60 pl-4 text-[0.95rem] leading-relaxed text-muted italic"
              >
                {message.text}
              </p>
            ) : (
              <div
                key={index}
                className="text-[1.05rem] leading-[1.75] whitespace-pre-wrap text-vellum"
              >
                {message.text}
              </div>
            ),
          )}

          {answer ? (
            <div className="text-[1.05rem] leading-[1.75] whitespace-pre-wrap text-vellum">
              {answer}
              <span className="answer-cursor" />
            </div>
          ) : null}

          {answer === '' && !error && (
            <p className="contemplating text-sm tracking-widest text-gild-dim">CONTEMPLATING</p>
          )}

          {notice && <p className="text-sm text-gild/80">{notice}</p>}
          {error && <p className="text-sm text-red-300/80">{error}</p>}
        </main>

        <footer className="sticky bottom-0 mt-8 bg-void/85 pt-4 pb-3 backdrop-blur-sm">
          {!ready ? null : remaining <= 0 ? (
            <Challenge
              messagesPerChallenge={messagesPerChallenge}
              turnstileSiteKey={turnstileSiteKey}
              spent={messages.length > 0}
              onGranted={(granted) => {
                setRemaining(granted)
                setError(null)
                setNotice(`${granted} messages are yours.`)
                requestAnimationFrame(() => inputRef.current?.focus())
              }}
            />
          ) : (
            <div className="rounded-lg border border-gild-dim/40 bg-ink/70 focus-within:border-gild/60">
              <textarea
                ref={inputRef}
                value={draft}
                rows={2}
                disabled={asking}
                placeholder="Who is it that is asking?"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void ask()
                  }
                }}
                className="w-full resize-none bg-transparent px-4 py-3 text-[0.95rem] leading-relaxed text-vellum outline-none placeholder:text-muted/50 disabled:opacity-50"
              />
              <div className="flex items-center justify-between border-t border-gild-dim/25 px-3 py-2">
                <button
                  type="button"
                  onClick={startOver}
                  className="text-[0.65rem] tracking-[0.24em] text-muted uppercase transition hover:text-gild"
                >
                  New question
                </button>
                <button
                  type="button"
                  onClick={() => void ask()}
                  disabled={asking || draft.trim().length === 0}
                  className="rounded border border-gild/50 px-4 py-1.5 text-[0.65rem] tracking-[0.24em] text-gild uppercase transition hover:bg-gild/10 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {asking ? 'Listening' : 'Ask'}
                </button>
              </div>
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}

export default App
