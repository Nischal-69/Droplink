/**
 * Pure transfer-statistics helpers (no DOM dependencies — safe to unit test).
 * All values derive from actual byte counts reported by the transfer loop.
 */

/** 0–100 progress percentage from real byte counts. */
export function progressPercent(transferredBytes: number, totalBytes: number): number {
  if (!Number.isFinite(transferredBytes) || !Number.isFinite(totalBytes)) return 0
  if (totalBytes <= 0) return 100
  return Math.min(100, Math.max(0, (transferredBytes / totalBytes) * 100))
}

/** Human transfer speed, e.g. 44040192 -> "42 MB/s". */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'] as const
  let value = bytesPerSecond
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}

/** Human ETA from real remaining bytes and measured speed. */
export function formatEta(
  totalBytes: number,
  transferredBytes: number,
  bytesPerSecond: number,
): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—'
  const remaining = Math.max(0, totalBytes - transferredBytes)
  if (remaining <= 0) return '0 sec'
  const seconds = remaining / bytesPerSecond
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes} min ${rest} sec`
}

/**
 * Sliding-window speedometer over cumulative byte counts.
 * Feed every progress update; returns the recent bytes/sec rate.
 */
export class Speedometer {
  private samples: { t: number; bytes: number }[] = []
  private lastSpeed = 0
  private windowMs: number

  constructor(windowMs = 3000) {
    this.windowMs = windowMs
  }

  reset(): void {
    this.samples = []
    this.lastSpeed = 0
  }

  push(cumulativeBytes: number, nowMs: number = Date.now()): number {
    const bytes = Math.max(0, cumulativeBytes)
    const last = this.samples[this.samples.length - 1]
    if (last && bytes < last.bytes) {
      this.reset()
      this.samples.push({ t: nowMs, bytes })
      return 0
    }
    if (!last || bytes !== last.bytes || nowMs !== last.t) {
      this.samples.push({ t: nowMs, bytes })
    }
    const cutoff = nowMs - this.windowMs
    while (this.samples.length > 2 && this.samples[0].t < cutoff) {
      this.samples.shift()
    }
    if (this.samples.length < 2) return this.lastSpeed
    const first = this.samples[0]
    const latest = this.samples[this.samples.length - 1]
    const deltaSeconds = (latest.t - first.t) / 1000
    if (deltaSeconds <= 0) return this.lastSpeed
    const speed = (latest.bytes - first.bytes) / deltaSeconds
    this.lastSpeed = Math.max(0, speed)
    return this.lastSpeed
  }
}
