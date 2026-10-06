/**
 * Pairing-link helpers: encode ONLY the transfer connection information
 * (receive mode + 6-digit code) into a shareable URL.
 *
 * Never put file contents, file names, or file bytes into the link —
 * the QR code built from this URL carries connection info only.
 * File bytes travel exclusively over the WebRTC DataChannel.
 */

export function normalizePairingCode(input: string | null | undefined): string {
  return (input ?? '').replace(/\D/g, '').slice(0, 6)
}

export function isValidPairingCode(input: string | null | undefined): boolean {
  return normalizePairingCode(input).length === 6
}

/**
 * Build the receiver URL, e.g. `http://192.168.1.5:5173/?mode=receive&code=482731`.
 * `base` defaults to the current origin + pathname in the browser.
 */
export function buildReceiveUrl(code: string, base?: string): string {
  const digits = normalizePairingCode(code)
  if (base) {
    try {
      const parsed = new URL(base)
      return `${parsed.origin}${parsed.pathname || '/'}?mode=receive&code=${digits}`
    } catch {
      // Fall through to the window-based form below.
    }
  }
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${window.location.pathname || '/'}?mode=receive&code=${digits}`
  }
  return `/?mode=receive&code=${digits}`
}

/** Extract `{ mode, code }` from a query string like `?mode=receive&code=482731`. */
export function parsePairingLink(search: string): {
  mode: 'send' | 'receive' | null
  code: string
} {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)
  const modeParam = params.get('mode')
  const mode = modeParam === 'receive' ? 'receive' : modeParam === 'send' ? 'send' : null
  return { mode, code: normalizePairingCode(params.get('code')) }
}
