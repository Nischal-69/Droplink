import { ArrowRight, MonitorSmartphone, RefreshCw, Send } from 'lucide-react'

type Props = {
  backendOnline: boolean
  socketConnected: boolean
  socketId: string | null
}

function Row({
  label,
  value,
  ok,
}: {
  label: string
  value: string
  ok: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="inline-flex items-center gap-1.5 font-medium text-dark">
        <span
          aria-hidden
          className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-success' : 'bg-danger'}`}
        />
        {value}
      </span>
    </div>
  )
}

export default function DevicesPanel({ backendOnline, socketConnected, socketId }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Nearby devices" className="rounded-xl border border-border bg-white p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-dark">Nearby devices</h2>
          <button
            type="button"
            disabled
            title="Discovery coming soon"
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted opacity-70"
          >
            <RefreshCw size={14} aria-hidden />
            Scan
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">Devices on the same Wi-Fi will appear here.</p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-border">
              <MonitorSmartphone size={18} className="text-primary" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-dark">Example — Office PC</p>
              <p className="text-xs text-muted">Design preview • not discoverable yet</p>
            </div>
            <button
              type="button"
              disabled
              title="Sending coming soon"
              className="inline-flex shrink-0 cursor-not-allowed items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white opacity-50"
            >
              <Send size={13} aria-hidden />
              Send
            </button>
          </div>

          <div className="rounded-lg border border-dashed border-border p-4 text-center">
            <p className="text-sm font-medium text-dark">Waiting for devices</p>
            <p className="mt-1 text-xs text-muted">
              Open DropLink on another device connected to the same network.
            </p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
              Discovery UI preview <ArrowRight size={13} aria-hidden />
            </span>
          </div>
        </div>
      </section>

      <section aria-label="Connection status" className="rounded-xl border border-border bg-white p-5 sm:p-6">
        <h2 className="text-base font-semibold text-dark">Connection</h2>
        <div className="mt-2 divide-y divide-border">
          <Row label="Signaling server" value={backendOnline ? 'Online' : 'Offline'} ok={backendOnline} />
          <Row label="Socket.IO" value={socketConnected ? 'Connected' : 'Disconnected'} ok={socketConnected} />
        </div>
        <p className="mt-3 truncate rounded-lg bg-background px-3 py-2 font-mono text-xs text-muted ring-1 ring-border">
          {socketId ? `socket ${socketId}` : 'socket — not connected'}
        </p>
        <p className="mt-2 text-xs text-muted">Used only for signaling. File bytes never touch the server.</p>
      </section>
    </div>
  )
}
