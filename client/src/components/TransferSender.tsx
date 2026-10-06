import { Check, Pause, Play, RefreshCw, Send, X } from 'lucide-react'
import type { FileTransfer } from '../hooks/useFileTransfer'
import { formatBytes } from '../utils/formatBytes'
import { formatEta, formatSpeed, progressPercent } from '../utils/transferStats'
import FileTypeIcon from './FileTypeIcon'

type Props = {
  files: { id: string; file: File }[]
  transfer: FileTransfer
  getChannel: () => RTCDataChannel | null
}

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

/** Sender transfer UI with real byte-driven progress — shown once the channel is open. */
export default function TransferSender({ files, transfer, getChannel }: Props) {
  const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0)
  const summary = `${files.length} ${files.length === 1 ? 'file' : 'files'} • ${formatBytes(totalBytes)}`
  const isSending = transfer.sendState === 'sending'
  const isPaused = isSending && transfer.sendPaused
  const active = files.find((item) => !transfer.sendProgress[item.id]?.done) ?? files[0]

  const handleSend = () => {
    void transfer.sendFiles(getChannel(), files)
  }

  const renderLivePanel = () => {
    if (!active || !isSending) return null
    const progress = transfer.sendProgress[active.id]
    const sent = progress?.sentBytes ?? 0
    const bps = progress?.bps ?? 0
    const percent = progressPercent(sent, active.file.size)
    return (
      <div
        className="mt-3 rounded-lg border border-border bg-background p-4"
        aria-live="polite"
        aria-label={`${isPaused ? 'Paused' : 'Sending'} ${active.file.name}, ${Math.round(percent)} percent`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {isPaused ? 'Paused' : 'Sending'}
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-dark" title={active.file.name}>
          {active.file.name}
        </p>
        <div className="mt-2">
          <ProgressBar value={percent} tall />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <p className="text-2xl font-bold text-dark">{Math.round(percent)}%</p>
          <p className="text-xs text-muted">
            {formatBytes(sent)} / {formatBytes(active.file.size)}
          </p>
        </div>
        <p className="mt-1 text-xs text-muted">
          {isPaused ? (
            'Paused — no chunks are being sent. Progress is preserved.'
          ) : (
            <>
              Speed: {bps > 0 ? formatSpeed(bps) : 'measuring…'} • Time remaining:{' '}
              {formatEta(active.file.size, sent, bps)}
            </>
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-2 text-left">
      <p className="text-center text-xs text-muted">{summary} — ready to send.</p>

      {renderLivePanel()}

      <ul className="mt-3 flex flex-col gap-2" aria-label="Transfer queue">
        {files.map((item) => {
          const progress = transfer.sendProgress[item.id]
          const sent = progress?.sentBytes ?? 0
          const percent = progressPercent(sent, item.file.size)
          const started = isSending || transfer.sendState === 'done'
          const status = !started
            ? null
            : progress?.done
              ? '100%'
              : isPaused && item.id === active?.id
                ? 'paused'
                : item.id === active?.id && isSending
                  ? `${Math.round(percent)}%`
                  : 'waiting'
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
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium" title={item.file.name}>
                      {item.file.name}
                    </p>
                    {status && (
                      <span
                        className={`shrink-0 text-xs font-semibold ${status === 'waiting' ? 'text-muted' : 'text-dark'}`}
                      >
                        {status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted">
                    {started
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
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          {isPaused ? (
            <button
              type="button"
              onClick={() => transfer.resumeSend(getChannel())}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              <Play size={15} aria-hidden /> Resume
            </button>
          ) : (
            <button
              type="button"
              onClick={() => transfer.pauseSend(getChannel())}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
            >
              <Pause size={15} aria-hidden /> Pause
            </button>
          )}
          <button
            type="button"
            onClick={transfer.cancelSend}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold hover:border-danger hover:text-danger"
          >
            <X size={15} aria-hidden /> Cancel
          </button>
        </div>
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
