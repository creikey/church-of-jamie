/**
 * embed — build the RAG corpus the "ask Jamie" worker retrieves from.
 *
 * Usage:
 *   npm run embed -- [--in converted.json] [--source self-realization-complete.txt]
 *
 * Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN in the environment (see README).
 *
 * One exchange is emitted per Jamie message: the message itself plus the conversation that
 * led to it (the message he replied to, and the messages immediately before his turn). The
 * embedding covers the whole exchange, so a question retrieves the moment someone asked him
 * something similar — not just a sentence that happens to share vocabulary.
 *
 * Consecutive Jamie messages share a *group*, so the worker can stitch a run of replies back
 * into one answer instead of spending ten retrieval slots on ten fragments of the same thought.
 *
 * Output (all under public/corpus/, served as static assets and read by the worker):
 *   meta.json    model + dimensions + per-exchange group/date/byte-offset tables
 *   vectors.bin  Float32 unit vectors, one row per exchange, in exchange order
 *   corpus.bin   UTF-8 "context\0answer" per exchange — sliced on demand, never parsed whole
 *   source.txt   copy of the philosophy text the worker puts in the system prompt
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import process from 'node:process'

// ---------------------------------------------------------------- shapes

interface ConvertedMessage {
  disciple_index: number
  timestamp: string
  message: string
  message_uuid: string
  reply_to_uuid?: string
}

interface Exchange {
  context: string
  answer: string
  group: number
  date: string
  embedText: string
}

// ---------------------------------------------------------------- config

/** Workers AI embedding model. Recorded in meta.json so the worker embeds queries the same way. */
const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5'

/** Workers AI accepts up to 100 strings per embedding request. */
const BATCH_SIZE = 96

/** How many messages before Jamie's turn count as the thing he's responding to. */
const CONTEXT_MESSAGES = 4

/** bge truncates around 512 tokens; keep the embedded text near that budget. */
const EMBED_CONTEXT_CHARS = 1200
const EMBED_ANSWER_CHARS = 1200

/** What we store for the prompt — more generous than what we embed. */
const STORED_CONTEXT_CHARS = 2000
const STORED_ANSWER_CHARS = 4000

const OUT_DIR = 'public/corpus'

// ---------------------------------------------------------------- exchanges

function speaker(index: number): string {
  return index === 0 ? 'Jamie' : `Disciple #${index}`
}

function tail(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(text.length - max)}`
}

function head(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * converted.json orders threads as contiguous blocks placed at the time each thread began, so
 * a timestamp that goes backwards is always the seam between two blocks. That's the only
 * boundary signal in the file, and it's enough: context never leaks across a seam.
 */
function unitStarts(records: ConvertedMessage[]): boolean[] {
  return records.map(
    (record, i) => i === 0 || Date.parse(record.timestamp) < Date.parse(records[i - 1].timestamp),
  )
}

function buildExchanges(records: ConvertedMessage[]): Exchange[] {
  const starts = unitStarts(records)
  const indexByUuid = new Map(records.map((record, i) => [record.message_uuid, i]))
  const exchanges: Exchange[] = []

  let group = -1
  let currentRun = -1

  for (let i = 0; i < records.length; i++) {
    if (records[i].disciple_index !== 0) continue

    // Walk back to the first message of this uninterrupted run of Jamie messages.
    let runStart = i
    while (runStart > 0 && !starts[runStart] && records[runStart - 1].disciple_index === 0) {
      runStart--
    }
    if (runStart !== currentRun) {
      currentRun = runStart
      group++
    }

    const lines: string[] = []

    // Whatever he explicitly replied to comes first, even if it scrolled out of the window.
    const referenced = records[runStart].reply_to_uuid
    const referencedIndex = referenced === undefined ? undefined : indexByUuid.get(referenced)
    if (referencedIndex !== undefined && referencedIndex < runStart - CONTEXT_MESSAGES) {
      lines.push(`${speaker(records[referencedIndex].disciple_index)}: ${records[referencedIndex].message}`)
    }

    if (!starts[runStart]) {
      const window: string[] = []
      for (let j = runStart - 1; j >= 0 && window.length < CONTEXT_MESSAGES; j--) {
        window.unshift(`${speaker(records[j].disciple_index)}: ${records[j].message}`)
        if (starts[j]) break
      }
      lines.push(...window)
    }

    const context = lines.join('\n')
    const answer = records[i].message

    exchanges.push({
      group,
      date: records[i].timestamp.slice(0, 10),
      // Keep the end of the context — the messages nearest his reply are the ones he answered.
      context: tail(context, STORED_CONTEXT_CHARS),
      answer: head(answer, STORED_ANSWER_CHARS),
      embedText: `${tail(context, EMBED_CONTEXT_CHARS)}\nJamie: ${head(answer, EMBED_ANSWER_CHARS)}`.trim(),
    })
  }

  return exchanges
}

// ---------------------------------------------------------------- embeddings

interface WorkersAiResponse {
  success: boolean
  errors?: { message: string }[]
  result?: { data: number[][] }
}

async function embedBatch(texts: string[], accountId: string, token: string): Promise<number[][]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${EMBED_MODEL}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: texts }),
    },
  )

  const payload = (await response.json()) as WorkersAiResponse
  if (!response.ok || !payload.success || !payload.result) {
    const detail = payload.errors?.map((e) => e.message).join('; ') ?? `HTTP ${response.status}`
    throw new Error(`Workers AI embedding failed: ${detail}`)
  }
  return payload.result.data
}

function normalize(vector: number[]): Float32Array {
  let sum = 0
  for (const value of vector) sum += value * value
  const scale = sum > 0 ? 1 / Math.sqrt(sum) : 0
  const unit = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) unit[i] = vector[i] * scale
  return unit
}

// ---------------------------------------------------------------- cli

function parseArgs(argv: string[]) {
  let input = 'converted.json'
  let source = 'self-realization-complete.txt'
  let dryRun = false

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in') input = argv[++i]
    else if (argv[i] === '--source') source = argv[++i]
    else if (argv[i] === '--dry-run') dryRun = true
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  return { input: resolve(input), source: resolve(source), dryRun }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. See the "Setting up the keys" section of the README — you need a Cloudflare API token with Workers AI access.`,
    )
  }
  return value
}

async function main() {
  const { input, source, dryRun } = parseArgs(process.argv.slice(2))

  const records = JSON.parse(await readFile(input, 'utf8')) as ConvertedMessage[]
  const philosophy = await readFile(source, 'utf8')
  console.log(`read ${records.length} messages from ${input}`)

  const exchanges = buildExchanges(records)
  const groupCount = new Set(exchanges.map((e) => e.group)).size
  console.log(`built ${exchanges.length} exchanges in ${groupCount} groups`)

  if (dryRun) {
    // Inspect what would be embedded without spending Workers AI neurons.
    for (const index of [0, Math.floor(exchanges.length / 3), exchanges.length - 1]) {
      const { group, context, answer } = exchanges[index]
      console.log(`\n--- exchange ${index} (group ${group}) ---`)
      console.log(`[context] ${tail(context, 400)}`)
      console.log(`[answer]  ${head(answer, 400)}`)
    }
    return
  }

  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID')
  const token = requireEnv('CLOUDFLARE_AI_TOKEN')

  const vectors: Float32Array[] = []
  for (let i = 0; i < exchanges.length; i += BATCH_SIZE) {
    const batch = exchanges.slice(i, i + BATCH_SIZE)
    const embedded = await embedBatch(batch.map((e) => e.embedText), accountId, token)
    for (const vector of embedded) vectors.push(normalize(vector))
    console.log(`  embedded ${Math.min(i + BATCH_SIZE, exchanges.length)}/${exchanges.length}`)
  }

  const dims = vectors[0].length
  const flat = new Float32Array(dims * vectors.length)
  vectors.forEach((vector, i) => flat.set(vector, i * dims))

  // Exchange texts go into one blob with an offset table, so the worker can decode the ten it
  // needs instead of parsing megabytes of JSON on every cold start.
  const encoder = new TextEncoder()
  const encoded = exchanges.map((e) => encoder.encode(`${e.context}\u0000${e.answer}`))
  const offsets = [0]
  for (const chunk of encoded) offsets.push(offsets[offsets.length - 1] + chunk.length)
  const corpus = new Uint8Array(offsets[offsets.length - 1])
  encoded.forEach((chunk, i) => corpus.set(chunk, offsets[i]))

  const outDir = resolve(OUT_DIR)
  await mkdir(outDir, { recursive: true })
  await writeFile(
    join(outDir, 'meta.json'),
    JSON.stringify({
      model: EMBED_MODEL,
      dims,
      count: exchanges.length,
      groups: exchanges.map((e) => e.group),
      dates: exchanges.map((e) => e.date),
      offsets,
    }),
  )
  await writeFile(join(outDir, 'vectors.bin'), flat)
  await writeFile(join(outDir, 'corpus.bin'), corpus)
  await writeFile(join(outDir, 'source.txt'), philosophy)

  console.log(
    [
      `model:    ${EMBED_MODEL} (${dims} dimensions)`,
      `vectors:  ${(flat.byteLength / 1e6).toFixed(2)} MB`,
      `corpus:   ${(corpus.byteLength / 1e6).toFixed(2)} MB`,
      `source:   ${(philosophy.length / 1e3).toFixed(1)} KB of philosophy text`,
      `wrote:    ${outDir}`,
    ].join('\n'),
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
