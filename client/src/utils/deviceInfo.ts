/**
 * Friendly device labels like "Chrome on Windows" / "Chrome on Android".
 *
 * Derived locally from the browser's user-agent (or `navigator.userAgentData`
 * when available). Only the resulting human-readable label is ever shared
 * with the peer for display — never IP addresses, ICE candidates, or raw
 * user-agent strings.
 */

const MAX_LABEL_LENGTH = 64

export function parseBrowserName(userAgent: string): string {
  const ua = userAgent || ''
  if (/\bEdgA?\b|\bEdge?\b/i.test(ua) && /edg/i.test(ua)) return 'Edge'
  if (/\bOPR\b|\bOpera\b/i.test(ua)) return 'Opera'
  if (/\bSamsungBrowser\b/i.test(ua)) return 'Samsung Internet'
  if (/\bFxiOS\b|\bFirefox\b/i.test(ua)) return 'Firefox'
  if (/\bCriOS\b|\bChrome\b|\bChromium\b/i.test(ua)) return 'Chrome'
  if (/\bSafari\b/i.test(ua) && /\bVersion\b/i.test(ua)) return 'Safari'
  if (/\bSafari\b/i.test(ua)) return 'Safari'
  return 'Browser'
}

export function parseOsName(userAgent: string): string {
  const ua = userAgent || ''
  if (/\bAndroid\b/i.test(ua)) return 'Android'
  if (/\biPhone\b|\biPad\b|\biPod\b/i.test(ua)) return 'iOS'
  if (/\bWindows\b/i.test(ua)) return 'Windows'
  if (/\bCrOS\b/i.test(ua)) return 'ChromeOS'
  if (/\bMac OS X\b|\bMacintosh\b/i.test(ua)) return 'macOS'
  if (/\bLinux\b/i.test(ua)) return 'Linux'
  return 'Unknown'
}

/** "Chrome" + "Windows" -> "Chrome on Windows". */
export function formatDeviceLabel(browser: string, os: string): string {
  const cleanBrowser = browser.trim() || 'Browser'
  const cleanOs = os.trim() || 'Unknown'
  return `${cleanBrowser} on ${cleanOs}`
}

/** Keep only printable characters and cap length before sharing a label. */
export function sanitizeDeviceLabel(input: string | null | undefined): string | null {
  if (input == null) return null
  const cleaned = String(input)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_LABEL_LENGTH)
  return cleaned || null
}

function brandToBrowser(brands: { brand: string }[] | undefined): string | null {
  if (!Array.isArray(brands)) return null
  const names = brands.map((entry) => entry.brand).join(' ')
  if (/edge/i.test(names)) return 'Edge'
  if (/opera/i.test(names)) return 'Opera'
  if (/samsung/i.test(names)) return 'Samsung Internet'
  if (/firefox/i.test(names)) return 'Firefox'
  if (/chrome/i.test(names)) return 'Chrome'
  if (/chromium/i.test(names)) return 'Chrome'
  if (/safari/i.test(names)) return 'Safari'
  if (/brave/i.test(names)) return 'Brave'
  return null
}

function normalizePlatformName(platform: string | undefined): string | null {
  if (!platform) return null
  const name = platform.trim()
  if (/^windows$/i.test(name)) return 'Windows'
  if (/^macos$/i.test(name)) return 'macOS'
  if (/^android$/i.test(name)) return 'Android'
  if (/^ios$/i.test(name)) return 'iOS'
  if (/^chrome ?os$/i.test(name)) return 'ChromeOS'
  if (/^linux$/i.test(name)) return 'Linux'
  return null
}

/**
 * Best-effort label for this device, e.g. "Chrome on Windows".
 * Safe to call outside a browser (falls back to a generic label).
 */
export function getLocalDeviceLabel(): string {
  try {
    if (typeof navigator === 'undefined') return 'Browser'
    const clientData = (navigator as Navigator & { userAgentData?: unknown }).userAgentData as
      | { brands?: { brand: string }[]; platform?: string }
      | undefined
    const fromBrands = brandToBrowser(clientData?.brands)
    const fromPlatform = normalizePlatformName(clientData?.platform)
    if (fromBrands && fromPlatform) return formatDeviceLabel(fromBrands, fromPlatform)
    const ua = navigator.userAgent || ''
    if (!ua) return fromBrands ?? 'Browser'
    return formatDeviceLabel(
      fromBrands ?? parseBrowserName(ua),
      fromPlatform ?? parseOsName(ua),
    )
  } catch {
    return 'Browser'
  }
}
