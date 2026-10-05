import { Wifi } from 'lucide-react'
import DropLinkLogo from './DropLinkLogo'

type Props = {
  backendOnline: boolean
  socketConnected: boolean
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-success' : 'bg-danger'}`}
    />
  )
}

export default function Header({ backendOnline, socketConnected }: Props) {
  const allOk = backendOnline && socketConnected

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <DropLinkLogo size={34} />
          <div className="leading-tight">
            <p className="text-base font-bold tracking-tight text-dark">DropLink</p>
            <p className="hidden text-xs text-muted sm:block">
              Peer-to-peer files on the same Wi-Fi
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted md:inline-flex">
            <Wifi size={14} className="text-primary" aria-hidden />
            Same Wi-Fi only
          </span>
          <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-dark">
            <StatusDot ok={allOk} />
            {allOk ? 'Connected' : 'Connecting'}
          </span>
        </div>
      </div>
    </header>
  )
}
