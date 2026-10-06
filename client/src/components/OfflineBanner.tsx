import { WifiOff } from 'lucide-react'
import { friendlyError } from '../utils/appErrors'

/** Plain-language offline notice. Rendered only while the browser is offline. */
export default function OfflineBanner() {
  const copy = friendlyError('offline')
  return (
    <div
      className="mt-4 flex items-start justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-center"
      role="alert"
    >
      <WifiOff size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden />
      <p className="text-xs leading-relaxed text-muted">
        <span className="font-semibold text-dark">{copy.title} </span>
        {copy.hint}
      </p>
    </div>
  )
}
