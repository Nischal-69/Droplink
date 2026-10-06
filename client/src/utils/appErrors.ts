/**
 * User-facing error states. The UI only ever renders these codes through
 * `friendlyError()` — raw technical details (server strings, DOMExceptions,
 * socket errors) are logged with console.debug and never shown directly.
 */

export type ErrorCode =
  | 'offline'
  | 'unreachable'
  | 'different-network'
  | 'unsupported'
  | 'peer-disconnected'
  | 'code-invalid'
  | 'code-expired'
  | 'room-full'
  | 'rate-limited'
  | 'transfer-failed'
  | 'out-of-memory'

export interface FriendlyError {
  title: string
  hint: string | null
}

const COPY: Record<ErrorCode, FriendlyError> = {
  offline: {
    title: 'You appear to be offline.',
    hint: 'Check your internet connection and try again.',
  },
  unreachable: {
    title: 'Unable to connect.',
    hint: 'Check your connection and try again.',
  },
  'different-network': {
    title: 'Unable to connect.',
    hint: 'Make sure both devices are on the same Wi-Fi network.',
  },
  unsupported: {
    title: 'Direct transfer is not supported in this browser.',
    hint: 'Try a recent version of Chrome, Edge, Firefox, or Safari.',
  },
  'peer-disconnected': {
    title: 'The other device disconnected.',
    hint: null,
  },
  'code-invalid': {
    title: 'That code did not work.',
    hint: 'Check the code and try again.',
  },
  'code-expired': {
    title: 'The connection expired.',
    hint: 'Get a new code and try again.',
  },
  'room-full': {
    title: 'This transfer is already connected.',
    hint: 'Ask the sender for a new code.',
  },
  'rate-limited': {
    title: 'Too many attempts.',
    hint: 'Wait a moment and try again.',
  },
  'transfer-failed': {
    title: 'Transfer failed.',
    hint: 'Check the connection and try again.',
  },
  'out-of-memory': {
    title: 'Your browser ran out of memory.',
    hint: 'Try smaller files or close other tabs, then retry.',
  },
}

/** Simple, non-technical copy for an error code. */
export function friendlyError(code: ErrorCode): FriendlyError {
  return COPY[code]
}

/** True when the browser reports no network connection at all. */
export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** Keep technical detail in diagnostics; the UI shows only the code. */
export function logTechnical(context: string, detail: unknown): void {
  if (typeof console !== 'undefined' && typeof console.debug === 'function') {
    console.debug(`[droplink] ${context}`, detail)
  }
}

/**
 * Map a signaling/connectivity failure to a user-facing code.
 * Offline is checked first so a dead network never shows a server error.
 */
export function classifySignalFailure(err: unknown): ErrorCode {
  logTechnical('signaling failure', err)
  if (isBrowserOffline()) return 'offline'
  return 'unreachable'
}

/**
 * Map a transfer failure to a user-facing code. Allocation failures
 * (huge Blob assembly, oversized buffers) surface as an out-of-memory
 * state instead of a cryptic exception message.
 */
export function classifyTransferFailure(err: unknown): ErrorCode {
  logTechnical('transfer failure', err)
  if (isBrowserOffline()) return 'offline'
  if (err instanceof DOMException && err.name === 'QuotaExceededError') return 'out-of-memory'
  if (err instanceof RangeError) return 'out-of-memory'
  return 'transfer-failed'
}

/**
 * Map a server pairing response string to a user-facing code so server
 * wording never reaches the UI directly.
 */
export function codeFromServerMessage(message: string | undefined): ErrorCode {
  const text = message ?? ''
  if (/expired/i.test(text)) return 'code-expired'
  if (/not found/i.test(text)) return 'code-invalid'
  if (/already full/i.test(text)) return 'room-full'
  if (/another tab/i.test(text)) return 'room-full'
  if (/too many attempts/i.test(text)) return 'rate-limited'
  logTechnical('unmapped server message', message)
  return 'unreachable'
}
