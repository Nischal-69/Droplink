import { Check, RefreshCw, Send, X } from 'lucide-react'
import type { FileTransfer } from '../hooks/useFileTransfer'
import { formatBytes } from '../utils/formatBytes'
import FileTypeIcon from './FileTypeIcon'

type Props = {
  files: { id: string; file: File }[]
  transfer: FileTransfer
  getChannel: () => RTCDataChannel | null
}

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

/** Sender transfer UI — rendered only after the DataChannel is open. */
export default function TransferSender({ files, transfer, getChannel }: Props) {
  const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0)
  const summary = `${files.length} ${files.length === 1 ? 'file' : 'files'} • ${formatBytes(totalBytes)}`
  const isSending = transfer.sendState === 'sending'

  const handleSend = () => {
    void transfer.sendFiles(getChannel(), files)
  }

  return (
    <div className="mt-2 text-left">
      <p className="text-center text-xs text-muted">{summary} — ready to send.</p>

      <ul className="mt-3 flex flex-col gap-2" aria-label="Files to send">
        {files.map((item) => {
          const progress = transfer.sendProgress[item.id]
          const sent = progress?.sentBytes ?? 0
          const percent = item.file.size === 0 ? 100 : (sent / item.file.size) * 100
          return (
            <li
              key={item.id}
              className="rounded-lg border border-border bg-background px-3 py-2.5"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-border">
                  <FileTypeIcon fileName={item.file.name} mimeType={item.file.type} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={item.file.name}>
                    {item.file.name}
                  </p>
                  <p className="text-xs text-muted">
                    {isSending || transfer.sendState !== 'idle'
                      ? `${formatBytes(sent)} of ${formatBytes(item.file.size)}`
                      : formatBytes(item.file.size)}
                  </p>
                </div>
                {transfer.sendState === 'done' && (
                  <Check size={16} className="shrink-0 text-success" aria-label="Sent" />
                )}
              </div>
              {(isSending || transfer.sendState === 'done') && (
                <div className="mt-2">
                  <ProgressBar value={percent} />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {transfer.sendState === 'idle' && (
        <button
          type="button"
          onClick={handleSend}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          <Send size={15} aria-hidden /> Send {files.length === 1 ? 'file' : `${files.length} files`}
        </button>
      )}

      {isSending && (
        <button
          type="button"
          onClick={transfer.cancelSend}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold hover:border-danger hover:text-danger"
        >
          <X size={15} aria-hidden /> Cancel transfer
        </button>
      )}

      {transfer.sendState === 'done' && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-sm font-medium text-success">
          <Check size={15} aria-hidden /> Transfer complete
        </p>
      )}

      {transfer.sendState === 'cancelled' && (
        <div className="mt-3 text-center">
          <p className="text-sm font-medium text-dark">Transfer cancelled</p>
          <button
            type="button"
            onClick={handleSend}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            <RefreshCw size={15} aria-hidden /> Send again
          </button>
        </div>
      )}

      {transfer.sendState === 'error' && (
        <div className="mt-3 text-center">
          <p className="text-xs text-danger" role="alert">
            {transfer.sendError ?? 'Transfer failed.'}
          </p>
          <button
            type="button"
            onClick={handleSend}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            <RefreshCw size={15} aria-hidden /> Retry transfer
          </button>
        </div>
      )}
    </div>
  )
}
