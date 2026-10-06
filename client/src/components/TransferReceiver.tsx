import { useState } from 'react'
import { Archive, Check, Download, Pause, X } from 'lucide-react'
import type { FileTransfer, ReceivedFile } from '../hooks/useFileTransfer'
import { friendlyError } from '../utils/appErrors'
import { formatBytes } from '../utils/formatBytes'
import { sanitizeDisplayName } from '../utils/transferProtocol'
import { progressPercent } from '../utils/transferStats'
import { createZipBlob, defaultZipName, triggerBlobDownload } from '../utils/zipFiles'
import FileTypeIcon from './FileTypeIcon'

function ProgressBar({ value, tall }: { value: number; tall?: boolean }) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={`w-full overflow-hidden rounded-full bg-background ring-1 ring-border ${tall ? 'h-2.5' : 'h-1.5'}`}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
    </div>
  )
}

/** Resolve the reconstructed bytes kept locally (never fetched from a server). */
async function resolveBlob(item: ReceivedFile): Promise<Blob | null> {
  if (item.blob) return item.blob
  if (item.blobUrl) {
    try {
      const response = await fetch(item.blobUrl)
      return await response.blob()
    } catch {
      return null
    }
  }
  return null
}

function downloadViaAnchor(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** Receiver transfer UI with real byte-driven progress — shown once the channel is open. */
export default function TransferReceiver({
  transfer,
  getChannel,
}: {
  transfer: FileTransfer
  getChannel: () => RTCDataChannel | null
}) {
  const [isZipping, setIsZipping] = useState(false)
  const [zipError, setZipError] = useState<string | null>(null)
  const receiveErrorCopy = transfer.receiveErrorCode ? friendlyError(transfer.receiveErrorCode) : null

  if (transfer.received.length === 0) {
    return (
      <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-muted">
        Stay on this screen — incoming files will appear here once the sender presses Send.
      </p>
    )
  }

  const active = transfer.received.find((item) => !item.done && !item.cancelled)
  const hasActive = active !== undefined
  const isPaused = transfer.receivePaused && hasActive
  const activePercent = active ? progressPercent(active.receivedBytes, active.size) : 0
  // Peer-provided names are sanitized for display (text, titles, labels).
  const activeDisplayName = active ? sanitizeDisplayName(active.name) : ''
  const completed = transfer.received.filter(
    (item) => item.done && !item.cancelled && (item.blobUrl || item.blob),
  )

  const handleSingleDownload = (item: ReceivedFile) => {
    if (item.blob) {
      // Browser saves the reconstructed Blob under its original filename.
      triggerBlobDownload(item.blob, item.name)
    } else if (item.blobUrl) {
      downloadViaAnchor(item.blobUrl, item.name)
    }
  }

  /** Package all finished files into a ZIP locally in the browser. */
  const handleDownloadAll = async () => {
    if (completed.length === 0 || isZipping) return
    // Single file: no ZIP needed — save it directly under its original name.
    if (completed.length === 1) {
      handleSingleDownload(completed[0])
      return
    }
    setIsZipping(true)
    setZipError(null)
    try {
      const entries = []
      for (const item of completed) {
        const blob = await resolveBlob(item)
        if (!blob) throw new Error(`Could not read "${item.name}" for zipping.`)
        entries.push({ name: item.name, blob })
      }
      const zipBlob = await createZipBlob(entries)
      triggerBlobDownload(zipBlob, defaultZipName())
    } catch {
      // Fall back to saving files one by one so the user still gets everything.
      try {
        for (const item of completed) {
          const blob = await resolveBlob(item)
          if (blob) {
            triggerBlobDownload(blob, item.name)
          } else if (item.blobUrl) {
            downloadViaAnchor(item.blobUrl, item.name)
          }
          await new Promise((resolve) => setTimeout(resolve, 400))
        }
        setZipError('Could not build a ZIP — downloaded the files individually instead.')
      } catch {
        // Saving can also fail (e.g. the browser refuses a huge Blob):
        // keep the plain message, the files themselves are untouched.
        setZipError('Could not create a ZIP archive.')
      }
    } finally {
        setIsZipping(false)
    }
  }

  return (
    <div className="mt-2 text-left">
      {receiveErrorCopy && (
        <div className="rounded-lg border border-border bg-background p-4 text-center" aria-live="polite">
          <p className="text-sm font-semibold text-dark" role="alert">
            {receiveErrorCopy.title}
          </p>
          {receiveErrorCopy.hint && (
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
              {receiveErrorCopy.hint}
            </p>
          )}
          <button
            type="button"
            onClick={transfer.dismissReceiveError}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold hover:border-primary hover:text-primary"
          >
            Dismiss
          </button>
        </div>
      )}
      {active && (
        <div
          className="rounded-lg border border-border bg-background p-4"
          aria-live="polite"
          aria-label={`${isPaused ? 'Paused' : 'Receiving'} ${activeDisplayName}, ${Math.round(activePercent)} percent`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {isPaused ? 'Paused by sender' : 'Receiving'}
            </p>
            {isPaused && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                <Pause size={12} aria-hidden /> Paused
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-dark" title={activeDisplayName}>
            {activeDisplayName}
          </p>
          <div className="mt-2">
            <ProgressBar value={activePercent} tall />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <p className="text-2xl font-bold text-dark">{Math.round(activePercent)}%</p>
            <p className="text-xs text-muted">
              {formatBytes(active.receivedBytes)} / {formatBytes(active.size)}
            </p>
          </div>
          {isPaused && (
            <p className="mt-1 text-xs text-muted">
              No data is arriving. Your received progress is preserved and resumes automatically.
            </p>
          )}
        </div>
      )}

      {hasActive && (
        <button
          type="button"
          onClick={() => transfer.cancelReceive(getChannel())}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold hover:border-danger hover:text-danger"
        >
          <X size={15} aria-hidden /> Cancel
        </button>
      )}

      {completed.length > 1 && (
        <div className="mt-2 rounded-lg border border-border bg-background px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-dark">
              {completed.length} files ready • {formatBytes(completed.reduce((sum, item) => sum + item.size, 0))}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleDownloadAll()}
            disabled={isZipping}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-dark px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            <Archive size={15} aria-hidden />
            {isZipping ? 'Preparing ZIP…' : 'Download All (ZIP)'}
          </button>
          {zipError && (
            <p className="mt-1.5 text-xs text-danger" role="alert">
              {zipError}
            </p>
          )}
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Packaged locally in your browser — files are never uploaded to a server.
          </p>
        </div>
      )}

      <ul className="mt-2 flex flex-col gap-2" aria-label="Transfer queue">
        {transfer.received.map((item) => {
          const percent = progressPercent(item.receivedBytes, item.size)
          const status = item.cancelled
            ? 'cancelled'
            : item.done
              ? '100%'
              : item.waiting
                ? 'waiting'
                : `${Math.round(percent)}%`
          const isWaiting = !item.done && !item.cancelled && item.waiting
          const isReady = item.done && !item.cancelled && (item.blobUrl || item.blob)
          const displayName = sanitizeDisplayName(item.name)
          return (
            <li key={item.fileId} className="rounded-lg border border-border bg-background px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-border">
                  <FileTypeIcon fileName={displayName} mimeType={item.mime} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium" title={displayName}>
                      {isReady && (
                        <Check
                          size={14}
                          className="mr-1 inline-block shrink-0 text-success"
                          aria-label="Complete"
                        />
                      )}
                      {displayName}
                    </p>
                    <span
                      className={`shrink-0 text-xs font-semibold ${isWaiting || item.cancelled ? 'text-muted' : 'text-dark'}`}
                    >
                      {status}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {item.cancelled
                      ? 'Cancelled'
                      : item.done
                        ? formatBytes(item.size)
                        : isWaiting
                          ? `${formatBytes(item.size)} • queued`
                          : `${formatBytes(item.receivedBytes)} of ${formatBytes(item.size)}`}
                  </p>
                </div>
                {isReady && !item.blobUrl && (
                  <Check size={16} className="shrink-0 text-success" aria-label="Received" />
                )}
              </div>
              {!item.done && !item.cancelled && (
                <div className="mt-2">
                  <ProgressBar value={percent} />
                </div>
              )}
              {isReady &&
                (item.blobUrl ? (
                  <a
                    href={item.blobUrl}
                    download={item.name}
                    className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                    aria-label={`Download ${displayName}`}
                  >
                    <Download size={15} aria-hidden /> Download
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSingleDownload(item)}
                    className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                    aria-label={`Download ${displayName}`}
                  >
                    <Download size={15} aria-hidden /> Download
                  </button>
                ))}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
