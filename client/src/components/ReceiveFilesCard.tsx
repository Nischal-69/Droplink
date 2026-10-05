import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Check, Lock } from 'lucide-react'
import PairingStatusBadge from './PairingStatusBadge'
import { usePairing } from '../hooks/usePairing'

type Props = {
  onSwitchToSend: () => void
}

function formatCodeInput(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, 6)
  return d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d
}

/**
 * Simple flat illustration: laptop + phone linked peer-to-peer.
 * Palette only: Primary / Border / Background / White / Muted.
 */
function DeviceIllustration() {
  return (
    <svg
      viewBox="0 0 260 120"
      fill="none"
      role="img"
      aria-label="Two devices connected directly"
      className="mx-auto h-28 w-auto sm:h-32"
    >
      <line
        x1="122"
        y1="72"
        x2="164"
        y2="72"
        stroke="#2563EB"
        strokeWidth="2"
        strokeDasharray="5 5"
        strokeLinecap="round"
      />
      <circle cx="143" cy="72" r="11" fill="#2563EB" />
      <path
        d="M139.5 74.8a3.4 3.4 0 0 0 4.8 0l2.3-2.3a3.4 3.4 0 0 0-4.8-4.8l-1.2 1.2"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M146.5 69.2a3.4 3.4 0 0 0-4.8 0l-2.3 2.3a3.4 3.4 0 0 0 4.8 4.8l1.2-1.2"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="28" y="42" width="94" height="60" rx="9" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <rect x="37" y="51" width="76" height="34" rx="4" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="1.5" />
      <rect x="45" y="62" width="34" height="5" rx="2.5" fill="#2563EB" opacity="0.85" />
      <rect x="45" y="71" width="52" height="4" rx="2" fill="#E2E8F0" />
      <rect x="58" y="102" width="34" height="5" rx="2.5" fill="#E2E8F0" />
      <rect x="164" y="30" width="56" height="84" rx="11" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <rect x="172" y="44" width="40" height="46" rx="4" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="1.5" />
      <rect x="179" y="54" width="26" height="5" rx="2.5" fill="#2563EB" opacity="0.85" />
      <rect x="179" y="63" width="26" height="4" rx="2" fill="#E2E8F0" />
      <rect x="179" y="71" width="18" height="4" rx="2" fill="#E2E8F0" />
      <circle cx="192" cy="101" r="3" fill="#64748B" />
    </svg>
  )
}

/** Receive screen — enter the sender's code to pair (signaling only). */
export default function ReceiveFilesCard({ onSwitchToSend }: Props) {
  const pairing = usePairing()
  const [digits, setDigits] = useState('')

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDigits(event.target.value.replace(/\D/g, '').slice(0, 6))
  }

  const handleConnect = (event: FormEvent) => {
    event.preventDefault()
    void pairing.joinRoom(digits)
  }

  const handleDisconnect = () => {
    pairing.leave()
    setDigits('')
  }

  const isConnected = pairing.status === 'connected'
  const isConnecting = pairing.status === 'connecting'

  return (
    <section
      aria-label="Receive files"
      className="mt-8 w-full rounded-xl border border-border bg-white p-6 sm:p-8"
    >
      <div className="flex items-center justify-center gap-2">
        <h2 className="text-center text-lg font-semibold">Receive files</h2>
        {pairing.status !== 'idle' && <PairingStatusBadge status={pairing.status} />}
      </div>
      <p className="mt-1 text-center text-sm text-muted">
        Connect with a device on the same network.
      </p>

      <div className="mt-5 rounded-lg border border-border bg-background px-4 py-6">
        <DeviceIllustration />

        {isConnected && pairing.code ? (
          <div className="text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-success/10">
              <Check size={22} className="text-success" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-semibold">Connected to sender</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-dark">
              {pairing.code}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Paired and ready. File receiving via WebRTC is not implemented yet.
            </p>
            <button
              type="button"
              onClick={handleDisconnect}
              className="mx-auto mt-4 inline-flex items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold hover:border-danger hover:text-danger"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <form onSubmit={handleConnect} className="mx-auto mt-4 max-w-xs text-center">
            <label
              htmlFor="receive-code"
              className="text-xs font-medium uppercase tracking-wide text-muted"
            >
              Sender&apos;s connection code
            </label>
            <input
              id="receive-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="482 731"
              value={formatCodeInput(digits)}
              onChange={handleInputChange}
              disabled={isConnecting}
              className="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-center font-mono text-2xl font-bold tracking-widest text-dark placeholder:text-muted/50 focus:border-primary focus:outline-none disabled:opacity-60"
            />
            {pairing.status === 'disconnected' && pairing.error ? (
              <p className="mt-2 text-xs text-danger" role="alert">
                {pairing.error}
              </p>
            ) : (
              <p className="mt-2 flex items-center justify-center gap-2 text-sm text-muted">
                <span
                  aria-hidden
                  className={`inline-block h-2 w-2 rounded-full ${
                    isConnecting ? 'animate-pulse bg-primary' : 'bg-muted'
                  }`}
                />
                {isConnecting ? 'Connecting...' : 'Waiting for sender...'}
              </p>
            )}
            <button
              type="submit"
              disabled={isConnecting || digits.length !== 6}
              className="mt-3 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isConnecting ? 'Connecting...' : 'Connect'}
            </button>
          </form>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => {
            pairing.leave()
            onSwitchToSend()
          }}
          className="flex-1 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
        >
          Send Files
        </button>
        <button
          type="button"
          disabled
          title="You are on the Receive screen"
          className="flex-1 cursor-default rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white"
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
