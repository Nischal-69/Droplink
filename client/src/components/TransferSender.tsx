import { Check, Pause, Play, RefreshCw, Send, X } from 'lucide-react'
import type { FileTransfer } from '../hooks/useFileTransfer'
import { friendlyError } from '../utils/appErrors'
import { formatBytes } from '../utils/formatBytes'
import { formatEta, formatSpeed, progressPercent } from '../utils/transferStats'
import FileTypeIcon from './FileTypeIcon'

type Props = {
  files: { id: string; file: File }[]
  transfer: FileTransfer
  getChannel: () => RTCDataChannel | null
  /** True while the DataChannel is open (used to pick the recovery message). */
  channelOpen: boolean
  /** Retry recovery: resume from confirmed offsets, or reconnect first. */
  onRetry: () => void
}

function ProgressBar({ value, tall }: { value: number; tall?: boolean }) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={`w-full overflow-hidden rounded-full bg-background ring-1 ring-border ${tall ? 'h-3 sm:h-2.5' : 'h-1.5'}`}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
    </div>
  )
}

/** Sender transfer UI with real byte-driven progress — shown once the channel is open. */
export default function TransferSender({ files, transfer, getChannel, channelOpen, onRetry }: Props) {
  const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0)
  const summary = `${files.length} ${files.length === 1 ? 'file' : 'files'} • ${formatBytes(totalBytes)}`
  const isSending = transfer.sendState === 'sending'
  const isResuming = transfer.sendState === 'resuming'
  const isActive = isSending || isResuming
  const isPaused = isActive && transfer.sendPaused
  const isInterrupted = transfer.sendState === 'interrupted'
  const active = files.find((item) => !transfer.sendProgress[item.id]?.done) ?? files[0]
  const preservedBytes = files.reduce(
    (sum, item) => sum + Math.min(transfer.sendProgress[item.id]?.sentBytes ?? 0, item.file.size),
    0,
  )
  const sendErrorCopy = transfer.sendErrorCode ? friendlyError(transfer.sendErrorCode) : null

  const handleSend = () => {
    void transfer.sendFiles(getChannel(), files)
  }

  const renderLivePanel = () => {
    if (!active || !isActive) return null
    const progress = transfer.sendProgress[active.id]
    const sent = progress?.sentBytes ?? 0
    const bps = progress?.bps ?? 0
    const percent = progressPercent(sent, active.file.size)
    const phase = isPaused ? 'Paused' : isResuming ? 'Resuming' : 'Sending'
    return (
      <div
        className="mt-3 rounded-lg border border-border bg-background p-4"
        aria-live="polite"
        aria-label={`${phase} ${active.file.name}, ${Math.round(percent)} percent`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{phase}</p>
        <p className="mt-1 truncate text-sm font-semibold text-dark" title={active.file.name}>
          {active.file.name}
        </p>
        <div className="mt-2">
          <ProgressBar value={percent} tall />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <p className="text-3xl font-bold text-dark sm:text-2xl">{Math.round(percent)}%</p>
          <p className="text-xs text-muted">
            {formatBytes(sent)} / {formatBytes(active.file.size)}
          </p>
        </div>
        <p className="mt-1 text-xs text-muted">
          {isPaused ? (
            'Paused — no chunks are being sent. Progress is preserved.'
          ) : isResuming ? (
            'Resuming from the last confirmed chunk — already-received bytes are not re-sent.'
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
          const started = isActive || transfer.sendState === 'done'
          const status = !started
            ? null
            : progress?.done
              ? '100%'
              : isPaused && item.id === active?.id
                ? 'paused'
                : item.id === active?.id && isActive
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
              {(isActive || transfer.sendState === 'done') && (
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
          className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          <Send size={15} aria-hidden /> Send {files.length === 1 ? 'file' : `${files.length} files`}
        </button>
      )}

      {isActive && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          {isPaused ? (
            <button
              type="button"
              onClick={() => transfer.resumeSend(getChannel())}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              <Play size={15} aria-hidden /> Resume
            </button>
          ) : (
            <button
              type="button"
              onClick={() => transfer.pauseSend(getChannel())}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
            >
              <Pause size={15} aria-hidden /> Pause
            </button>
          )}
          <button
            type="button"
            onClick={transfer.cancelSend}
            className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold hover:border-danger hover:text-danger"
          >
            <X size={15} aria-hidden /> Cancel
          </button>
        </div>
      )}

      {isInterrupted && (
        <div className="mt-3 rounded-lg border border-border bg-background p-4 text-center" aria-live="polite">
          <p className="text-sm font-semibold text-dark">
            {channelOpen ? 'Transfer interrupted' : 'Connection interrupted'}
          </p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
            {channelOpen
              ? 'The link is back but the transfer could not continue yet. Your progress is preserved.'
              : 'Attempting reconnection… your progress is preserved and the transfer will continue from the last confirmed chunk.'}
          </p>
          <p className="mt-2 text-xs font-medium text-dark" aria-live="polite">
            {formatBytes(preservedBytes)} of {formatBytes(totalBytes)} preserved
          </p>
          <div className="mt-1">
            <ProgressBar value={(preservedBytes / Math.max(1, totalBytes)) * 100} />
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            <RefreshCw size={15} aria-hidden /> Retry
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
            className="mt-2 inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            <RefreshCw size={15} aria-hidden /> Send again
          </button>
        </div>
      )}

      {transfer.sendState === 'error' && (
        <div className="mt-3 text-center" aria-live="polite">
          <p className="text-sm font-semibold text-dark" role="alert">
            {sendErrorCopy?.title ?? 'Transfer failed.'}
          </p>
          {sendErrorCopy?.hint && (
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
              {sendErrorCopy.hint}
            </p>
          )}
          <button
            type="button"
            onClick={handleSend}
            className="mt-2 inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            <RefreshCw size={15} aria-hidden /> Retry transfer
          </button>
        </div>
      )}
    </div>
  )
}
