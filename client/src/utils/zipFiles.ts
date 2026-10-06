/**
 * Local ZIP + download helpers (no DOM-free pure core + thin DOM trigger).
 *
 * Everything runs in the browser — files are never sent through the server.
 * The ZIP uses the STORE method (no compression): it only packages the
 * already-reconstructed Blobs into a single archive for "Download All".
 *
 * Format references: PKWARE APPNOTE local file header (0x04034b50),
 * central directory (0x02014b50), end of central directory (0x06054b50).
 */

export type ZipEntry = {
  name: string
  data: Uint8Array
}

export type NamedBlob = {
  name: string
  blob: Blob
}

const UTF8_FLAG = 0x0800
const METHOD_STORE = 0
const VERSION_NEEDED = 20

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

/** CRC-32 (IEEE) over raw bytes — required by the ZIP format even with STORE. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i += 1) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Strip path separators / traversal so a sender-provided name can never
 * escape the archive root. Keeps only the base name.
 */
export function sanitizeZipName(name: string): string {
  const base = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .pop() ?? ''
  const trimmed = base.trim()
  if (!trimmed) return 'file'
  // ZIP filename length field is 16-bit; TextEncoder may expand, so be conservative.
  return trimmed.length > 180 ? trimmed.slice(0, 180) : trimmed
}

/** Make archive names unique: "a.txt" -> "a (1).txt". */
export function deduplicateZipNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((raw) => {
    let candidate = raw
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
    const dot = raw.lastIndexOf('.')
    const stem = dot > 0 ? raw.slice(0, dot) : raw
    const ext = dot > 0 ? raw.slice(dot) : ''
    let counter = 1
    while (used.has(candidate)) {
      candidate = `${stem} (${counter})${ext}`
      counter += 1
    }
    used.add(candidate)
    return candidate
  })
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((Math.floor(date.getSeconds() / 2) & 0x1f) << 0)
  const day = Math.max(1, date.getDate() & 0x1f)
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    day
  return { time, date: dosDate }
}

/**
 * Build a valid STORE-only ZIP archive from in-memory bytes.
 * Pure (no DOM) — safe to unit test. Throws on empty input or >4 GiB entries
 * (classic ZIP32 limits) so callers can fall back to individual downloads.
 */
export function buildZipBytes(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  if (entries.length === 0) throw new Error('Nothing to zip.')
  const encoder = new TextEncoder()
  const names = deduplicateZipNames(entries.map((entry) => sanitizeZipName(entry.name)))
  const fileNames = entries.map((_, index) => encoder.encode(names[index]))
  const { time: dosTime, date: dosDate } = dosDateTime(now)

  for (const entry of entries) {
    if (entry.data.length > 0xffffffff) {
      throw new Error(`"${entry.name}" is too large for a ZIP archive.`)
    }
  }

  let totalSize = 22 // EOCD
  for (let i = 0; i < entries.length; i += 1) {
    totalSize += 30 + fileNames[i].length + entries[i].data.length
    totalSize += 46 + fileNames[i].length
  }

  const out = new Uint8Array(totalSize)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  let offset = 0
  const centralOffsets: number[] = []

  for (let i = 0; i < entries.length; i += 1) {
    const { data } = entries[i]
    const fileName = fileNames[i]
    const checksum = crc32(data)
    centralOffsets.push(offset)

    view.setUint32(offset + 0, 0x04034b50, true)
    view.setUint16(offset + 4, VERSION_NEEDED, true)
    view.setUint16(offset + 6, UTF8_FLAG, true)
    view.setUint16(offset + 8, METHOD_STORE, true)
    view.setUint16(offset + 10, dosTime, true)
    view.setUint16(offset + 12, dosDate, true)
    view.setUint32(offset + 14, checksum, true)
    view.setUint32(offset + 18, data.length, true)
    view.setUint32(offset + 22, data.length, true)
    view.setUint16(offset + 26, fileName.length, true)
    view.setUint16(offset + 28, 0, true)
    offset += 30
    out.set(fileName, offset)
    offset += fileName.length
    out.set(data, offset)
    offset += data.length
  }

  const centralStart = offset
  for (let i = 0; i < entries.length; i += 1) {
    const { data } = entries[i]
    const fileName = fileNames[i]
    const checksum = crc32(data)

    view.setUint32(offset + 0, 0x02014b50, true)
    view.setUint16(offset + 4, VERSION_NEEDED, true)
    view.setUint16(offset + 6, VERSION_NEEDED, true)
    view.setUint16(offset + 8, UTF8_FLAG, true)
    view.setUint16(offset + 10, METHOD_STORE, true)
    view.setUint16(offset + 12, dosTime, true)
    view.setUint16(offset + 14, dosDate, true)
    view.setUint32(offset + 16, checksum, true)
    view.setUint32(offset + 20, data.length, true)
    view.setUint32(offset + 24, data.length, true)
    view.setUint16(offset + 28, fileName.length, true)
    view.setUint16(offset + 30, 0, true)
    view.setUint16(offset + 32, 0, true)
    view.setUint16(offset + 34, 0, true)
    view.setUint16(offset + 36, 0, true)
    view.setUint32(offset + 38, 0, true)
    view.setUint32(offset + 42, centralOffsets[i], true)
    offset += 46
    out.set(fileName, offset)
    offset += fileName.length
  }
  const centralSize = offset - centralStart

  view.setUint32(offset + 0, 0x06054b50, true)
  view.setUint16(offset + 4, 0, true)
  view.setUint16(offset + 6, 0, true)
  view.setUint16(offset + 8, entries.length, true)
  view.setUint16(offset + 10, entries.length, true)
  view.setUint32(offset + 12, centralSize, true)
  view.setUint32(offset + 16, centralStart, true)
  view.setUint16(offset + 20, 0, true)

  return out
}

/**
 * Package reconstructed Blobs into a ZIP Blob entirely in the browser.
 * Reads one file at a time so peak memory is ~ZIP size + largest file.
 */
export async function createZipBlob(files: NamedBlob[], now: Date = new Date()): Promise<Blob> {
  if (files.length === 0) throw new Error('Nothing to zip.')
  const entries: ZipEntry[] = []
  for (const file of files) {
    const buffer = await file.blob.arrayBuffer()
    entries.push({ name: file.name, data: new Uint8Array(buffer) })
  }
  const bytes = buildZipBytes(entries, now)
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' })
}

export function defaultZipName(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `droplink-files-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.zip`
}

/**
 * Trigger a browser "Save as" for an in-memory Blob with the original filename.
 * Uses a temporary object URL + anchor click — no server involved.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename || 'download'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
