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

export type QueueEntry = {
  fileId: string
  name: string
  size: number
  mime: string
}

export type ControlMessage =
  | { kind: 'transfer-start'; transferId: string; fileCount: number; totalBytes: number }
  | { kind: 'queue'; transferId: string; files: QueueEntry[] }
  | { kind: 'file-start'; transferId: string; fileId: string; name: string; size: number; mime: string }
  | { kind: 'file-end'; transferId: string; fileId: string }
  | { kind: 'transfer-complete'; transferId: string }
  | { kind: 'transfer-cancel'; transferId: string; fileId?: string }
  | { kind: 'transfer-pause'; transferId: string }
  | { kind: 'transfer-resume'; transferId: string }

function isValidQueueEntry(entry: unknown): entry is QueueEntry {
  if (!entry || typeof entry !== 'object') return false
  const record = entry as Record<string, unknown>
  return (
    typeof record['fileId'] === 'string' &&
    typeof record['name'] === 'string' &&
    typeof record['size'] === 'number' &&
    Number.isFinite(record['size']) &&
    (record['size'] as number) >= 0 &&
    typeof record['mime'] === 'string'
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
  switch (message['kind']) {
    case 'transfer-start':
      if (typeof message['fileCount'] !== 'number' || typeof message['totalBytes'] !== 'number') return null
      break
    case 'queue':
      if (!Array.isArray(message['files']) || !(message['files'] as unknown[]).every(isValidQueueEntry)) {
        return null
      }
      break
    case 'file-start':
      if (
        typeof message['fileId'] !== 'string' ||
        typeof message['name'] !== 'string' ||
        typeof message['size'] !== 'number' ||
        typeof message['mime'] !== 'string'
      ) {
        return null
      }
      if (!Number.isFinite(message['size']) || (message['size'] as number) < 0) return null
      break
    case 'file-end':
      if (typeof message['fileId'] !== 'string') return null
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

export function makeTransferId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
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

/** Short cooperative wait used while paused — keeps the loop responsive to resume/cancel. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

/**
 * Stream files over an open channel: metadata first, then 64 KiB chunks
 * with backpressure. Reads one slice at a time so huge files are never
 * fully loaded. Throws when the channel closes mid-transfer.
 *
 * Pause is real, not cosmetic: while `isPaused()` is true the loop emits
 * no chunk frames at all and holds its exact byte offset, so resume
 * continues from the same offset. Cancel (via `isAborted()`) is honored
 * even while paused so a paused transfer can still be stopped cleanly.
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
  },
): Promise<TransferOutcome> {
  if (channel.readyState !== 'open') {
    throw new Error('Direct connection is not open.')
  }
  const transferId = options?.transferId ?? makeTransferId('tx')
  const aborted = options?.isAborted ?? (() => false)
  const paused = options?.isPaused ?? (() => false)
  const report = options?.onProgress ?? (() => undefined)
  options?.onTransferId?.(transferId)
  const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0)
  channel.bufferedAmountLowThreshold = LOW_WATER_MARK

  channel.send(
    encodeControl({ kind: 'transfer-start', transferId, fileCount: files.length, totalBytes }),
  )
  // Full manifest up front so the receiver sees the complete queue immediately.
  channel.send(
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
    channel.send(
      encodeControl({
        kind: 'file-start',
        transferId,
        fileId,
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
      }),
    )
    let offset = 0
    report(fileId, 0, file.size === 0)
    while (offset < file.size) {
      if (aborted()) break
      // Real pause: hold the exact offset and emit nothing until resumed.
      while (paused() && !aborted()) {
        await delay(50)
      }
      if (aborted()) break
      if (channel.readyState !== 'open') {
        throw new Error('Direct connection closed during transfer.')
      }
      await waitForDrain(channel)
      if (aborted()) break
      // Drain may have resolved while paused — never emit a chunk while paused.
      if (paused()) continue
      const end = Math.min(offset + CHUNK_SIZE, file.size)
      const chunk = await file.slice(offset, end).arrayBuffer()
      channel.send(chunk)
      offset = end
      report(fileId, offset, false)
    }
    if (aborted()) {
      channel.send(encodeControl({ kind: 'transfer-cancel', transferId, fileId }))
      break
    }
    channel.send(encodeControl({ kind: 'file-end', transferId, fileId }))
    report(fileId, file.size, true)
  }
  if (aborted()) {
    channel.send(encodeControl({ kind: 'transfer-cancel', transferId }))
    return { status: 'cancelled', transferId }
  }
  channel.send(encodeControl({ kind: 'transfer-complete', transferId }))
  return { status: 'done', transferId }
}
