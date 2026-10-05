import type { PairingStatus } from '../hooks/usePairing'

const LABEL: Record<PairingStatus, string> = {
  idle: 'Not connected',
  connecting: 'Connecting',
  waiting: 'Waiting',
  connected: 'Connected',
  disconnected: 'Disconnected',
}

function dotClass(status: PairingStatus): string {
  switch (status) {
    case 'connected':
      return 'bg-success'
    case 'disconnected':
      return 'bg-danger'
    case 'connecting':
    case 'waiting':
      return 'bg-primary animate-pulse'
    default:
      return 'bg-muted'
  }
}

/** Small connection-status badge using palette colors only. */
export default function PairingStatusBadge({ status }: { status: PairingStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-dark">
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${dotClass(status)}`} />
      {LABEL[status]}
    </span>
  )
}
