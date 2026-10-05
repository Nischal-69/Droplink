import { Download, Lock } from 'lucide-react'

type Props = {
  onSwitchToSend: () => void
}

/** Receive-mode preview — no connection logic yet. */
export default function ReceiveFilesCard({ onSwitchToSend }: Props) {
  return (
    <section
      aria-label="Receive files"
      className="mt-8 w-full rounded-xl border border-border bg-white p-6 sm:p-8"
    >
      <h2 className="text-center text-lg font-semibold">Receive files</h2>

      <div className="mt-5 rounded-lg border border-dashed border-border bg-background px-4 py-8 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
          <Download size={22} className="text-primary" aria-hidden />
        </span>
        <p className="mt-3 text-sm font-semibold">Waiting for sender</p>
        <p className="mt-1 text-sm text-muted">Enter the code from the sending device</p>
        <div className="mx-auto mt-4 flex max-w-xs flex-col gap-2">
          <input
            type="text"
            disabled
            placeholder="Enter receive code"
            title="Receiving coming soon"
            className="w-full cursor-not-allowed rounded-lg border border-border bg-white px-3 py-2 text-center text-sm opacity-60"
          />
          <button
            type="button"
            disabled
            title="Receiving coming soon"
            className="w-full cursor-not-allowed rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white opacity-50"
          >
            Connect
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onSwitchToSend}
          className="flex-1 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
        >
          Send Files
        </button>
        <button
          type="button"
          disabled
          title="Receiving coming soon"
          className="flex-1 cursor-not-allowed rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white opacity-50"
        >
          Receive Files
        </button>
      </div>

      <p className="mt-5 flex items-start justify-center gap-1.5 text-center text-xs leading-relaxed text-muted">
        <Lock size={13} className="mt-0.5 shrink-0" aria-hidden />
        No cloud storage. No file uploads. Direct device-to-device transfer.
      </p>
    </section>
  )
}
