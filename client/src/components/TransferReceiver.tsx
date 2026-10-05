import { Check, Download } from 'lucide-react'
import type { FileTransfer } from '../hooks/useFileTransfer'
import { formatBytes } from '../utils/formatBytes'
import { progressPercent } from '../utils/transferStats'
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

/** Receiver transfer UI with real byte-driven progress — shown once the channel is open. */
export default function TransferReceiver({ transfer }: { transfer: FileTransfer }) {
  if (transfer.received.length === 0) {
    return (
      <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-muted">
        Stay on this screen — incoming files will appear here once the sender presses Send.
      </p>
    )
  }

  const active = transfer.received.find((item) => !item.done && !item.cancelled)
  const activePercent = active ? progressPercent(active.receivedBytes, active.size) : 0

  return (
    <div className="mt-2 text-left">
      {active && (
        <div
          className="rounded-lg border border-border bg-background p-4"
          aria-live="polite"
          aria-label={`Receiving ${active.name}, ${Math.round(activePercent)} percent`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Receiving</p>
          <p className="mt-1 truncate text-sm font-semibold text-dark" title={active.name}>
            {active.name}
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
          return (
            <li key={item.fileId} className="rounded-lg border border-border bg-background px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-border">
                  <FileTypeIcon fileName={item.name} mimeType={item.mime} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium" title={item.name}>
                      {item.name}
                    </p>
                    <span
                      className={`shrink-0 text-xs font-semibold ${isWaiting || item.cancelled ? 'text-muted' : 'text-dark'}`}
                    >
                      {status}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {item.cancelled
                      ? 'Cancelled by sender'
                      : item.done
                        ? formatBytes(item.size)
                        : isWaiting
                          ? `${formatBytes(item.size)} • queued`
                          : `${formatBytes(item.receivedBytes)} of ${formatBytes(item.size)}`}
                  </p>
                </div>
                {item.done && !item.cancelled && (
                  <Check size={16} className="shrink-0 text-success" aria-label="Received" />
                )}
              </div>
              {!item.done && !item.cancelled && (
                <div className="mt-2">
                  <ProgressBar value={percent} />
                </div>
              )}
              {item.done && !item.cancelled && item.blobUrl && (
                <a
                  href={item.blobUrl}
                  download={item.name}
                  className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                >
                  <Download size={15} aria-hidden /> Download {item.name}
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
