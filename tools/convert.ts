/**
 * convert — turn a folder of DiscordChatExporter JSON exports into a single
 * flat, pseudo-anonymized message array suitable for RAG ingestion.
 *
 * Usage:
 *   npm run convert -- <export-dir> [--out converted.json] [--jamie <id|username>] [--compact]
 *
 * Ordering rules:
 *   - Messages that live directly in a channel ("uncategorized") are ordered chronologically.
 *   - Each thread is ordered as a single unit, placed at the time the thread began, with its
 *     own messages chronological inside it. So a thread that starts at t=3 emits all of its
 *     messages before the channel message at t=4, even if the thread ran for months.
 *
 * Attachments, embeds, stickers and reactions are dropped entirely — this corpus is text.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import process from 'node:process'

// ---------------------------------------------------------------- export shapes

interface ExportRole {
  id: string
  name: string
}

interface ExportAuthor {
  id: string
  name: string
  nickname?: string | null
  roles?: ExportRole[]
}

interface ExportMessage {
  id: string
  type: string
  timestamp: string
  content: string
  author: ExportAuthor
  reference?: { messageId?: string | null } | null
}

interface ExportChannel {
  id: string
  type: string
  name: string
  category?: string | null
}

interface ExportFile {
  channel: ExportChannel
  messages: ExportMessage[]
}

// ---------------------------------------------------------------- output shape

interface OutputMessage {
  disciple_index: number
  timestamp: string
  message: string
  message_uuid: string
  reply_to_uuid?: string
}

/** A thread (all of its messages) or a single standalone channel message. */
interface Unit {
  startMs: number
  startId: string
  messages: ExportMessage[]
}

// ---------------------------------------------------------------- config

/** Message types that carry actual conversation. Everything else is server noise. */
const CONVERSATIONAL_TYPES = new Set(['Default', 'Reply'])

/** Jamie is always disciple 0; everyone else is anonymized. */
const DEFAULT_JAMIE = 'jamie0773'

/** Fixed namespace so re-running the converter produces the same uuids. */
const UUID_NAMESPACE = '6ba7b812-9dad-11d1-80b4-00c04fd430c8'

// ---------------------------------------------------------------- helpers

function isThreadChannel(channel: ExportChannel): boolean {
  return channel.type.includes('Thread')
}

function isJamie(author: ExportAuthor, selector: string): boolean {
  const s = selector.toLowerCase()
  return (
    author.id === selector ||
    author.name.toLowerCase() === s ||
    (author.nickname ?? '').toLowerCase() === s
  )
}

/**
 * DiscordChatExporter occasionally writes a truncated message object when it is
 * interrupted (one of the exports here is missing a closing brace). Retry the
 * parse, patching in the brace the parser says it wanted, before giving up.
 */
function parseTolerant(text: string, label: string): ExportFile {
  let candidate = text
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return JSON.parse(candidate) as ExportFile
    } catch (error) {
      const position = (error as { message: string }).message.match(/position (\d+)/)
      if (!position || !/Expected ','/.test((error as Error).message)) throw error
      const at = Number(position[1])
      candidate = `${candidate.slice(0, at)}}${candidate.slice(at)}`
      console.warn(`  repaired unterminated object in ${label} at offset ${at}`)
    }
  }
  return JSON.parse(candidate) as ExportFile
}

/** Deterministic UUIDv5 of the discord message id, so ids are stable across runs. */
function messageUuid(discordId: string): string {
  const namespace = Buffer.from(UUID_NAMESPACE.replace(/-/g, ''), 'hex')
  const hash = createHash('sha1')
    .update(namespace)
    .update(Buffer.from(discordId, 'utf8'))
    .digest()
  hash[6] = (hash[6] & 0x0f) | 0x50 // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Snowflakes sort chronologically, so they are a stable tiebreak for equal timestamps. */
function compareSnowflake(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}

// ---------------------------------------------------------------- conversion

async function readExportDir(dir: string): Promise<ExportFile[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    // The exporter drops its own runtime config next to the exports.
    .filter((e) => !e.name.startsWith('DiscordChatExporter'))
    .map((e) => e.name)
    .sort()

  const exports: ExportFile[] = []
  for (const name of files) {
    const text = await readFile(join(dir, name), 'utf8')
    const parsed = parseTolerant(text, name)
    if (!parsed.channel || !Array.isArray(parsed.messages)) {
      console.warn(`  skipping ${name}: not a channel export`)
      continue
    }
    exports.push(parsed)
  }
  return exports
}

function buildUnits(exports: ExportFile[]): { units: Unit[]; dropped: number } {
  const units: Unit[] = []
  let dropped = 0

  const keep = (m: ExportMessage) =>
    CONVERSATIONAL_TYPES.has(m.type) && m.content.trim().length > 0

  for (const file of exports) {
    const messages = file.messages.filter((m) => {
      if (keep(m)) return true
      dropped++
      return false
    })
    if (messages.length === 0) continue

    messages.sort(
      (a, b) =>
        Date.parse(a.timestamp) - Date.parse(b.timestamp) || compareSnowflake(a.id, b.id),
    )

    if (isThreadChannel(file.channel)) {
      const first = messages[0]
      units.push({ startMs: Date.parse(first.timestamp), startId: first.id, messages })
    } else {
      for (const m of messages) {
        units.push({ startMs: Date.parse(m.timestamp), startId: m.id, messages: [m] })
      }
    }
  }

  units.sort((a, b) => a.startMs - b.startMs || compareSnowflake(a.startId, b.startId))
  return { units, dropped }
}

/** Assigns "Jamie" / "Disciple #N" labels in order of first appearance. */
class Roster {
  private indexes = new Map<string, number>()
  private next = 1
  private jamieSelector: string

  constructor(jamieSelector: string) {
    this.jamieSelector = jamieSelector
  }

  indexOf(author: ExportAuthor): number {
    if (isJamie(author, this.jamieSelector)) {
      this.indexes.set(author.id, 0)
      return 0
    }
    return this.indexById(author.id)
  }

  /** Mentions can name people who never posted; they still get a stable identity. */
  indexById(id: string): number {
    const existing = this.indexes.get(id)
    if (existing !== undefined) return existing
    const assigned = this.next++
    this.indexes.set(id, assigned)
    return assigned
  }

  label(index: number): string {
    return index === 0 ? 'Jamie' : `Disciple #${index}`
  }

  get discipleCount(): number {
    return this.next - 1
  }

  get sawJamie(): boolean {
    return [...this.indexes.values()].includes(0)
  }
}

/** Replaces discord markup that leaks identities or renders as raw ids. */
function renderContent(content: string, roster: Roster, roleNames: Map<string, string>): string {
  return content
    .replace(/<@!?(\d+)>/g, (_, id: string) => roster.label(roster.indexById(id)))
    .replace(/<@&(\d+)>/g, (_, id: string) => `@${roleNames.get(id) ?? 'role'}`)
    .replace(/<#\d+>/g, '#channel')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .trim()
}

/** Role mentions render as raw ids, so collect the names the export does give us. */
function collectRoleNames(exports: ExportFile[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const file of exports) {
    for (const message of file.messages) {
      for (const role of message.author.roles ?? []) names.set(role.id, role.name)
    }
  }
  return names
}

function convert(units: Unit[], jamieSelector: string, roleNames: Map<string, string>) {
  const ordered = units.flatMap((u) => u.messages)
  const roster = new Roster(jamieSelector)

  const uuids = new Map<string, string>()
  for (const m of ordered) uuids.set(m.id, messageUuid(m.id))

  const out: OutputMessage[] = []
  let unresolvedReplies = 0

  for (const m of ordered) {
    const record: OutputMessage = {
      disciple_index: roster.indexOf(m.author),
      timestamp: new Date(m.timestamp).toISOString(),
      message: renderContent(m.content, roster, roleNames),
      message_uuid: uuids.get(m.id)!,
    }
    const referenced = m.reference?.messageId
    if (referenced) {
      const target = uuids.get(referenced)
      // Replies can point at messages outside the export (deleted, or a channel we don't have).
      if (target) record.reply_to_uuid = target
      else unresolvedReplies++
    }
    out.push(record)
  }

  return { out, roster, unresolvedReplies }
}

// ---------------------------------------------------------------- cli

function parseArgs(argv: string[]) {
  let dir: string | undefined
  let out = 'converted.json'
  let jamie = DEFAULT_JAMIE
  let compact = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--out') out = argv[++i]
    else if (arg === '--jamie') jamie = argv[++i]
    else if (arg === '--compact') compact = true
    else if (arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`)
    else if (dir === undefined) dir = arg
    else throw new Error(`unexpected argument: ${arg}`)
  }

  if (!dir) {
    throw new Error(
      'usage: npm run convert -- <export-dir> [--out converted.json] [--jamie <id|username>] [--compact]',
    )
  }
  return { dir: resolve(dir), out: resolve(out), jamie, compact }
}

async function main() {
  const { dir, out, jamie, compact } = parseArgs(process.argv.slice(2))

  console.log(`reading exports from ${dir}`)
  const exports = await readExportDir(dir)
  const threadCount = exports.filter((e) => isThreadChannel(e.channel)).length

  const { units, dropped } = buildUnits(exports)
  const { out: messages, roster, unresolvedReplies } = convert(
    units,
    jamie,
    collectRoleNames(exports),
  )

  if (!roster.sawJamie) {
    throw new Error(
      `no messages from "${jamie}" — pass --jamie <id|username> to identify him in this export`,
    )
  }

  await writeFile(out, JSON.stringify(messages, null, compact ? 0 : 2))

  const jamieMessages = messages.filter((m) => m.disciple_index === 0).length
  console.log(
    [
      `channels:   ${exports.length} (${threadCount} threads, ${exports.length - threadCount} flat)`,
      `messages:   ${messages.length} kept, ${dropped} dropped (system/empty/image-only)`,
      `from jamie: ${jamieMessages}`,
      `disciples:  ${roster.discipleCount}`,
      `replies:    ${messages.filter((m) => m.reply_to_uuid).length} linked, ${unresolvedReplies} pointing outside the export`,
      `wrote:      ${out}`,
    ].join('\n'),
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
