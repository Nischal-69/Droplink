import type { ReactNode } from 'react'
import { Check, RefreshCw } from 'lucide-react'
import type { RtcStatus } from '../hooks/useWebRTC'

type Props = {
  rtcStatus: RtcStatus
  rtcError: string | null
  onRetry: () => void
  /** Rendered only once the WebRTC connection is actually open. */
  children?: ReactNode
}

/**
 * Direct-connection gate: the next step (`children`) renders
 * only after the DataChannel reports `open`.
 */
export default function DirectConnectionPanel({ rtcStatus, rtcError, onRetry, children }: Props) {
  if (rtcStatus === 'open') {
    return (
      <div className="text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-success/10">
          <Check size={22} className="text-success" aria-hidden />
        </span>
        <p className="mt-3 text-sm font-semibold text-dark">Direct connection established</p>
        {children}
      </div>
    )
  }

  if (rtcStatus === 'failed' || rtcStatus === 'closed') {
    return (
      <div className="text-center">
        <p className="text-sm font-semibold text-dark">
          {rtcStatus === 'failed' ? 'Connection failed' : 'Connection closed'}
        </p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
          {rtcError ?? 'The direct connection could not be established.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mx-auto mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <RefreshCw size={15} aria-hidden /> Retry connection
        </button>
      </div>
    )
  }

  return (
    <div className="text-center">
      <p className="flex items-center justify-center gap-2 text-sm font-medium text-dark">
        <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
        Establishing direct connection...
      </p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
        Exchanging connection info via the signaling server. No file data leaves your device.
      </p>
    </div>
  )
}
