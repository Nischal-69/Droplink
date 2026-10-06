import { Check } from 'lucide-react'
import type { PairingStatus } from '../hooks/usePairing'

type Props = {
  status: PairingStatus
  /** This device's role in the transfer. */
  localRole: 'sender' | 'receiver'
  /** Friendly label for this device, e.g. "Chrome on Windows". */
  localDevice: string
  /** Friendly label for the peer, e.g. "Chrome on Android" (null until joined). */
  peerDevice: string | null
}

/**
 * Simple flat network illustration: a local-network hub linked to a
 * laptop and a phone. Links light up once the nearby device connects.
 * Palette only: Primary / Border / Background / White / Muted / Success.
 */
export function NetworkIllustration({ linked }: { linked: boolean }) {
  const link = linked ? '#2563EB' : '#E2E8F0'
  const hub = linked ? '#2563EB' : '#64748B'
  return (
    <svg
      viewBox="0 0 260 132"
      fill="none"
      role="img"
      aria-label={linked ? 'Two devices linked through the local network' : 'Devices on the local network'}
      className="mx-auto h-28 w-auto sm:h-32"
    >
      {/* Links from the hub to each device. */}
      <line
        x1="130"
        y1="38"
        x2="75"
        y2="72"
        stroke={link}
        strokeWidth="2"
        strokeDasharray={linked ? undefined : '5 5'}
        strokeLinecap="round"
      />
      <line
        x1="130"
        y1="38"
        x2="192"
        y2="60"
        stroke={link}
        strokeWidth="2"
        strokeDasharray={linked ? undefined : '5 5'}
        strokeLinecap="round"
      />
      {/* Hub (local network). */}
      <circle cx="130" cy="30" r="12" fill={hub} />
      {linked ? (
        <>
          <path
            d="M124 30a8.5 8.5 0 0 1 12 0"
            stroke="#FFFFFF"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M126.8 30a4.6 4.6 0 0 1 6.4 0"
            stroke="#FFFFFF"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="130" cy="30" r="1.4" fill="#FFFFFF" />
        </>
      ) : (
        <circle cx="130" cy="30" r="3" fill="#FFFFFF" />
      )}
      {/* Laptop (left). */}
      <rect x="28" y="66" width="94" height="52" rx="9" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <rect x="37" y="74" width="76" height="28" rx="4" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="1.5" />
      <rect x="45" y="83" width="34" height="5" rx="2.5" fill="#2563EB" opacity="0.85" />
      <rect x="45" y="91" width="52" height="4" rx="2" fill="#E2E8F0" />
      {/* Phone (right). */}
      <rect x="164" y="52" width="56" height="66" rx="11" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <rect x="172" y="64" width="40" height="32" rx="4" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="1.5" />
      <rect x="179" y="72" width="26" height="5" rx="2.5" fill="#2563EB" opacity="0.85" />
      <rect x="179" y="81" width="18" height="4" rx="2" fill="#E2E8F0" />
      <circle cx="192" cy="106" r="3" fill="#64748B" />
      {linked && (
        <>
          <circle cx="75" cy="40" r="5" fill="#16A34A" />
          <path
            d="M72.8 40l1.6 1.6 3-3"
            stroke="#FFFFFF"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  )
}

/**
 * Same-network connection state, made explicit:
 * - "Connected to local network" once the signaling room is live.
 * - "Nearby device connected" once the peer joins, with per-role labels
 *   ("Sender: Chrome on Windows", "Receiver: Chrome on Android").
 * Device labels are friendly display names only — IP addresses are never shown.
 */
export default function NetworkStatusPanel({ status, localRole, localDevice, peerDevice }: Props) {
  const onNetwork = status === 'waiting' || status === 'connected'
  const linked = status === 'connected'
  const peerRole = localRole === 'sender' ? 'Receiver' : 'Sender'
  const localTitle = localRole === 'sender' ? 'Sender' : 'Receiver'

  return (
    <div aria-live="polite" className="text-center">
      <NetworkIllustration linked={linked} />

      {onNetwork ? (
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-success/10 px-3 py-1.5 text-sm font-bold text-success">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-success" />
          Connected to local network
        </p>
      ) : status === 'connecting' ? (
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-bold text-primary">
          <span aria-hidden className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
          Connecting to local network…
        </p>
      ) : (
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-background px-3 py-1.5 text-sm font-bold text-muted ring-1 ring-border">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-muted" />
          Not connected
        </p>
      )}

      {linked ? (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-sm font-semibold text-dark">
          <Check size={16} className="text-success" aria-hidden />
          Nearby device connected
        </p>
      ) : (
        onNetwork && (
          <p className="mt-2 flex items-center justify-center gap-2 text-sm text-muted">
            <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
            Waiting for a nearby device…
          </p>
        )
      )}

      <dl className="mx-auto mt-3 grid max-w-xs grid-cols-1 gap-2 text-left min-[400px]:grid-cols-2">
        <div className="rounded-lg border border-border bg-white px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {localTitle} • this device
          </dt>
          <dd className="mt-0.5 truncate text-sm font-semibold text-dark" title={localDevice}>
            {localDevice}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-white px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{peerRole}</dt>
          <dd
            className={`mt-0.5 truncate text-sm font-semibold ${peerDevice ? 'text-dark' : 'text-muted'}`}
            title={peerDevice ?? undefined}
          >
            {peerDevice ?? (onNetwork ? 'Waiting…' : '—')}
          </dd>
        </div>
      </dl>
    </div>
  )
}
