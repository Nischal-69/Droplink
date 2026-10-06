/**
 * Pure transfer-protocol helpers (no DOM dependencies — safe to unit test).
 *
 * Wire format over the reliable, ordered WebRTC DataChannel:
 * - Control frames are JSON strings (metadata first).
 * - File bytes travel as raw binary frames, one file at a time, in order.
 * - Nothing here touches the network or the signaling server.
 */

/** 64 KiB per chunk — safely below typical DataChannel max-message sizes. */
export const CHUNK_SIZE = 64 * 1024
/** Pause producing chunks while this many bytes are still buffered. */
export const HIGH_WATER_MARK = 1024 * 1024
/** Resume once the buffer drains to this level. */
export const LOW_WATER_MARK = 256 * 1024
/** Minimum gap between progress state updates. */
export const PROGRESS_THROTTLE_MS = 120
/**
 * Inbound metadata bounds. Peer-provided values are never trusted blindly:
 * oversized or misshapen frames are rejected before they reach the app.
 */
export const MAX_TRANSFER_ID_LENGTH = 128
export const MAX_FILE_ID_LENGTH = 128
/** Raw wire cap; receipt sanitizing trims stored names to MAX_FILE_NAME_LENGTH. */
export const MAX_RAW_NAME_LENGTH = 1024
export const MAX_FILE_NAME_LENGTH = 255
export const MAX_MIME_LENGTH = 128
export const MAX_QUEUE_FILES = 256
/** Largest single file the protocol will describe (1 TiB). */
export const MAX_FILE_SIZE = 2 ** 40
/** Displayed names are shortened for layout and safety. */
export const MAX_DISPLAY_NAME_LENGTH = 80

export type QueueEntry = {
  fileId: string
  name: string
  size: number
  mime: string
}

export type ControlMessage =
  | { kind: 'transfer-start'; transferId: string; fileCount: number; totalBytes: number }
  | { kind: 'queue'; transferId: string; files: QueueEntry[] }
  | { kind: 'file-start'; transferId: string; fileId: string; name: string; size: number; mime: string; offset?: number }
  | { kind: 'file-end'; transferId: string; fileId: string }
  | { kind: 'transfer-complete'; transferId: string }
  | { kind: 'transfer-cancel'; transferId: string; fileId?: string }
  | { kind: 'transfer-pause'; transferId: string }
  | { kind: 'transfer-resume'; transferId: string }
  | { kind: 'resume-query'; transferId: string; fileId: string }
  | { kind: 'resume-state'; transferId: string; fileId: string; receivedBytes: number }

function isValidQueueEntry(entry: unknown): entry is QueueEntry {
  if (!entry || typeof entry !== 'object') return false
  const record = entry as Record<string, unknown>
  return (
    typeof record['fileId'] === 'string' &&
    (record['fileId'] as string).length > 0 &&
    (record['fileId'] as string).length <= MAX_FILE_ID_LENGTH &&
    typeof record['name'] === 'string' &&
    (record['name'] as string).length > 0 &&
    (record['name'] as string).length <= MAX_RAW_NAME_LENGTH &&
    typeof record['size'] === 'number' &&
    Number.isFinite(record['size']) &&
    (record['size'] as number) >= 0 &&
    (record['size'] as number) <= MAX_FILE_SIZE &&
    typeof record['mime'] === 'string' &&
    (record['mime'] as string).length <= 512
  )
}

/** Unicode bidi override/isolate controls commonly abused to spoof names. */
function isBidiControl(code: number): boolean {
  return (
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x200e ||
    code === 0x200f ||
    code === 0x061c
  )
}

/**
 * Sanitize a peer-provided filename for storage/download use: drop control
 * characters, bidi overrides, and path separators; trim; cap length.
 * Never returns an empty string.
 */
export function sanitizeFileName(name: unknown): string {
  if (typeof name !== 'string') return 'file'
  let out = ''
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 32 || code === 127) continue
    if (code === 47 || code === 92) continue
    if (isBidiControl(code)) continue
    out += ch
  }
  const trimmed = out.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..') return 'file'
  const chars = Array.from(trimmed)
  const capped = chars.length > MAX_FILE_NAME_LENGTH ? chars.slice(0, MAX_FILE_NAME_LENGTH).join('') : trimmed
  const recapped = capped.trim()
  if (!recapped || recapped === '.' || recapped === '..') return 'file'
  return recapped
}

/** Sanitize a peer-provided MIME label: printable ASCII only, capped. */
export function sanitizeMimeType(mime: unknown): string {
  if (typeof mime !== 'string') return 'application/octet-stream'
  let out = ''
  for (const ch of mime) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 32 || code > 126) continue
    out += ch
  }
  const trimmed = out.trim().slice(0, MAX_MIME_LENGTH)
  return trimmed || 'application/octet-stream'
}

/**
 * Sanitize a filename for display (text, titles, aria labels): strip
 * controls and bidi overrides, fold line breaks to spaces, collapse runs
 * of spaces, and shorten with an ellipsis. Never returns an empty string.
 */
export function sanitizeDisplayName(name: unknown): string {
  if (typeof name !== 'string') return 'file'
  let out = ''
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 9 || code === 10 || code === 13 || code === 32) {
      out += ' '
      continue
    }
    if (code < 32 || code === 127) continue
    if (isBidiControl(code)) continue
    out += ch
  }
  const collapsed = out.split(' ').filter((word) => word.length > 0).join(' ')
  if (!collapsed) return 'file'
  const chars = Array.from(collapsed)
  if (chars.length > MAX_DISPLAY_NAME_LENGTH) {
    return chars.slice(0, MAX_DISPLAY_NAME_LENGTH - 3).join('') + '...'
  }
  return collapsed
}

  function isValidOffset(value: unknown): boolean {
    return (
      value === undefined ||
      (typeof value === 'number' && Number.isFinite(value) && (value as number) >= 0)
    )
  }

export function encodeControl(message: ControlMessage): string {
  return JSON.stringify(message)
}

/** Parse and validate an inbound control frame. Returns null when malformed. */
export function decodeControl(raw: string): ControlMessage | null {
  let message: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    message = parsed as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof message['kind'] !== 'string' || typeof message['transferId'] !== 'string') return null
  if (message['transferId'].length === 0 || message['transferId'].length > MAX_TRANSFER_ID_LENGTH) {
    return null
  }
  switch (message['kind']) {
    case 'transfer-start':
      if (typeof message['fileCount'] !== 'number' || typeof message['totalBytes'] !== 'number') return null
      if (!Number.isInteger(message['fileCount'] as number)) return null
      if ((message['fileCount'] as number) < 0 || (message['fileCount'] as number) > MAX_QUEUE_FILES) {
        return null
      }
      if (!Number.isFinite(message['totalBytes'] as number) || (message['totalBytes'] as number) < 0) {
        return null
      }
      break
    case 'queue':
      if (!Array.isArray(message['files']) || !(message['files'] as unknown[]).every(isValidQueueEntry)) {
        return null
      }
      if ((message['files'] as unknown[]).length > MAX_QUEUE_FILES) return null
      break
    case 'file-start':
      if (
        typeof message['fileId'] !== 'string' ||
        (message['fileId'] as string).length === 0 ||
        (message['fileId'] as string).length > MAX_FILE_ID_LENGTH ||
        typeof message['name'] !== 'string' ||
        (message['name'] as string).length === 0 ||
        (message['name'] as string).length > MAX_RAW_NAME_LENGTH ||
        typeof message['size'] !== 'number' ||
        typeof message['mime'] !== 'string' ||
        (message['mime'] as string).length > 512
      ) {
        return null
      }
      if (!Number.isFinite(message['size']) || (message['size'] as number) < 0) return null
      if ((message['size'] as number) > MAX_FILE_SIZE) return null
      if (!isValidOffset(message['offset'])) return null
      break
    case 'file-end':
      if (typeof message['fileId'] !== 'string') return null
      if ((message['fileId'] as string).length === 0 || (message['fileId'] as string).length > MAX_FILE_ID_LENGTH) {
        return null
      }
      break
    case 'resume-query':
      if (typeof message['fileId'] !== 'string') return null
      if ((message['fileId'] as string).length === 0 || (message['fileId'] as string).length > MAX_FILE_ID_LENGTH) {
        return null
      }
      break
    case 'resume-state':
      if (typeof message['fileId'] !== 'string') return null
      if ((message['fileId'] as string).length === 0 || (message['fileId'] as string).length > MAX_FILE_ID_LENGTH) {
        return null
      }
      if (
        typeof message['receivedBytes'] !== 'number' ||
        !Number.isFinite(message['receivedBytes']) ||
        (message['receivedBytes'] as number) < 0
      ) {
        return null
      }
      break
    case 'transfer-complete':
    case 'transfer-cancel':
    case 'transfer-pause':
    case 'transfer-resume':
      break
    default:
      return null
  }
  return message as unknown as ControlMessage
}

/** Number of chunks needed for a byte count (0 bytes -> 0 chunks). */
export function chunkCount(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0
  return Math.ceil(size / CHUNK_SIZE)
}

/**
 * Unpredictable temporary transfer id. Uses a CSPRNG in all cases —
 * randomUUID when available, otherwise getRandomValues (which, unlike
 * randomUUID, is also exposed in non-secure contexts such as plain-HTTP
 * LAN addresses). Never falls back to Math.random.
 */
export function makeTransferId(prefix: string): string {
  const g = globalThis.crypto
  if (g && typeof g.randomUUID === 'function') {
    try {
      return `${prefix}-${g.randomUUID()}`
    } catch {
      // Fall through to the manual CSPRNG form below.
    }
  }
  if (!g || typeof g.getRandomValues !== 'function') {
    throw new Error('Secure random generator unavailable.')
  }
  const bytes = new Uint8Array(16)
  g.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${prefix}-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Minimal DataChannel surface the sender needs (real or mocked). */
export type MinimalChannel = {
  send: {
    (data: string): void
    (data: ArrayBuffer): void
  }
  readonly bufferedAmount: number
  bufferedAmountLowThreshold: number
  readonly readyState: string
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

/** File surface the sender needs — satisfied by the DOM `File`. */
export type SendableFile = {
  name: string
  size: number
  type: string
  slice: (start: number, end: number) => Blob
}

/** Wait until the channel buffer drains enough for the next chunk. */
export function waitForDrain(channel: MinimalChannel): Promise<void> {
  if (channel.bufferedAmount <= HIGH_WATER_MARK) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      channel.removeEventListener('bufferedamountlow', onLow)
      resolve()
    }
    const onLow = () => finish()
    channel.addEventListener('bufferedamountlow', onLow)
    // Fallback: let one more chunk through, then re-check on the next chunk.
    globalThis.setTimeout(finish, 5000)
  })
}

export type TransferOutcome = {
  status: 'done' | 'cancelled'
  transferId: string
}

/**
 * Thrown when the DataChannel drops mid-transfer (closed between checks,
 * or `send()` itself throws). Distinct from genuine failures so callers
 * can preserve progress and offer resume instead of reporting an error.
 */
export class TransferInterruptedError extends Error {
  constructor(message = 'Direct connection interrupted during transfer.') {
    super(message)
    this.name = 'TransferInterruptedError'
  }
}

/** Send one frame, translating a dead channel into TransferInterruptedError. */
function sendFrame(channel: MinimalChannel, data: string | ArrayBuffer): void {
  try {
    ;(channel.send as (payload: string | ArrayBuffer) => void)(data)
  } catch {
    throw new TransferInterruptedError()
  }
}

/** Clamp a resume offset into the valid range for a file. */
export function clampResumeOffset(offset: number, size: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0
  if (!Number.isFinite(size) || size < 0) return 0
  return Math.min(Math.floor(offset), size)
}

/**
 * Trim stored chunks down to exactly `targetBytes`, keeping the byte prefix
 * intact (a straddling tail chunk is sliced). Rebuilds from the front so the
 * kept bytes are precisely the first N bytes the sender will resume after.
 */
export function truncateParts(
  parts: ArrayBuffer[],
  receivedBytes: number,
  targetBytes: number,
): { parts: ArrayBuffer[]; receivedBytes: number } {
  const target = Math.max(0, Math.min(Math.floor(targetBytes), Math.floor(receivedBytes)))
  if (target >= receivedBytes) return { parts: parts.slice(), receivedBytes }
  const trimmed: ArrayBuffer[] = []
  let kept = 0
  for (const part of parts) {
    if (kept >= target) break
    if (kept + part.byteLength <= target) {
      trimmed.push(part)
      kept += part.byteLength
    } else {
      const need = target - kept
      if (need > 0) {
        trimmed.push(part.slice(0, need))
        kept += need
      }
      break
    }
  }
  return { parts: trimmed, receivedBytes: kept }
}

/** Short cooperative wait used while paused — keeps the loop responsive to resume/cancel. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

/**
 * Stream files over an open channel: metadata first, then 64 KiB chunks
 * with backpressure. Reads one slice at a time so huge files are never
 * fully loaded. Throws TransferInterruptedError when the channel drops
 * mid-transfer (preserving nothing here — callers keep offsets); throws
 * any other failure as a plain Error.
 *
 * Pause is real, not cosmetic: while `isPaused()` is true the loop emits
 * no chunk frames at all and holds its exact byte offset, so resume
 * continues from the same offset. Cancel (via `isAborted()`) is honored
 * even while paused so a paused transfer can still be stopped cleanly.
 *
 * `startOffsets[fileId]` resumes a file mid-stream (recovery): the
 * file-start frame carries the offset and chunks begin there, so bytes
 * the receiver already confirmed are never re-sent.
 */
export async function transferFiles(
  channel: MinimalChannel,
  files: { id: string; file: SendableFile }[],
  options?: {
    isAborted?: () => boolean
    isPaused?: () => boolean
    onProgress?: (fileId: string, sentBytes: number, done: boolean) => void
    transferId?: string
    onTransferId?: (transferId: string) => void
    startOffsets?: Record<string, number>
  },
): Promise<TransferOutcome> {
  if (channel.readyState !== 'open') {
    throw new TransferInterruptedError('Direct connection is not open.')
  }
  const transferId = options?.transferId ?? makeTransferId('tx')
  const aborted = options?.isAborted ?? (() => false)
  const paused = options?.isPaused ?? (() => false)
  const report = options?.onProgress ?? (() => undefined)
  const offsets = options?.startOffsets ?? {}
  options?.onTransferId?.(transferId)
  const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0)
  channel.bufferedAmountLowThreshold = LOW_WATER_MARK

  sendFrame(
    channel,
    encodeControl({ kind: 'transfer-start', transferId, fileCount: files.length, totalBytes }),
  )
  // Full manifest up front so the receiver sees the complete queue immediately.
  sendFrame(
    channel,
    encodeControl({
      kind: 'queue',
      transferId,
      files: files.map(({ id: fileId, file }) => ({
        fileId,
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
      })),
    }),
  )
  for (const { id: fileId, file } of files) {
    if (aborted()) break
    // Freeze between files while paused: no file-start, no chunks, offset preserved.
    while (paused() && !aborted()) {
      await delay(50)
    }
    if (aborted()) break
    const startOffset = clampResumeOffset(offsets[fileId] ?? 0, file.size)
    sendFrame(
      channel,
      encodeControl({
        kind: 'file-start',
        transferId,
        fileId,
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        offset: startOffset,
      }),
    )
    let offset = startOffset
    report(fileId, offset, offset >= file.size)
    while (offset < file.size) {
      if (aborted()) break
      // Real pause: hold the exact offset and emit nothing until resumed.
      while (paused() && !aborted()) {
        await delay(50)
      }
      if (aborted()) break
      if (channel.readyState !== 'open') {
        throw new TransferInterruptedError('Direct connection closed during transfer.')
      }
      await waitForDrain(channel)
      if (aborted()) break
      // Drain may have resolved while paused — never emit a chunk while paused.
      if (paused()) continue
      const end = Math.min(offset + CHUNK_SIZE, file.size)
      const chunk = await file.slice(offset, end).arrayBuffer()
      sendFrame(channel, chunk)
      offset = end
      report(fileId, offset, false)
    }
    if (aborted()) {
      sendFrame(channel, encodeControl({ kind: 'transfer-cancel', transferId, fileId }))
      break
    }
    sendFrame(channel, encodeControl({ kind: 'file-end', transferId, fileId }))
    report(fileId, file.size, true)
  }
  if (aborted()) {
    sendFrame(channel, encodeControl({ kind: 'transfer-cancel', transferId }))
    return { status: 'cancelled', transferId }
  }
  sendFrame(channel, encodeControl({ kind: 'transfer-complete', transferId }))
  return { status: 'done', transferId }
}
