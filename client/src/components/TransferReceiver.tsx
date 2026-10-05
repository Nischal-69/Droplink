import { Check, Download } from 'lucide-react'
import type { FileTransfer } from '../hooks/useFileTransfer'
import { formatBytes } from '../utils/formatBytes'
import FileTypeIcon from './FileTypeIcon'

function ProgressBar({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className="h-1.5 w-full overflow-hidden rounded-full bg-background ring-1 ring-border"
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
    </div>
  )
}

/** Receiver transfer UI — rendered only after the DataChannel is open. */
export default function TransferReceiver({ transfer }: { transfer: FileTransfer }) {
  if (transfer.received.length === 0) {
    return (
      <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-muted">
        Stay on this screen — incoming files will appear here once the sender presses Send.
      </p>
    )
  }

  return (
    <ul className="mt-2 flex flex-col gap-2 text-left" aria-label="Incoming files">
      {transfer.received.map((item) => {
        const percent = item.size === 0 ? 100 : (item.receivedBytes / item.size) * 100
        return (
          <li key={item.fileId} className="rounded-lg border border-border bg-background px-3 py-2.5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-border">
                <FileTypeIcon fileName={item.name} mimeType={item.mime} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={item.name}>
                  {item.name}
                </p>
                <p className="text-xs text-muted">
                  {item.cancelled
                    ? 'Cancelled by sender'
                    : item.done
                      ? formatBytes(item.size)
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
  )
}
