import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { ArrowRight, Check, Copy, Lock, Upload, X } from 'lucide-react'
import QRCode from 'react-qr-code'
import DirectConnectionPanel from './DirectConnectionPanel'
import FileTypeIcon from './FileTypeIcon'
import NetworkStatusPanel from './NetworkStatusPanel'
import PairingStatusBadge from './PairingStatusBadge'
import TransferSender from './TransferSender'
import { useFileTransfer } from '../hooks/useFileTransfer'
import { usePairing } from '../hooks/usePairing'
import { useWebRTC } from '../hooks/useWebRTC'
import { formatBytes } from '../utils/formatBytes'
import { buildReceiveUrl } from '../utils/pairingLink'

type StoredFile = {
  id: string
  /** File object kept in browser memory only — never read, never uploaded. */
  file: File
}

type Props = {
  onSwitchToReceive: () => void
}

export default function SendFilesCard({ onSwitchToReceive }: Props) {
  const [files, setFiles] = useState<StoredFile[]>([])
  const [dragging, setDragging] = useState(false)
  const [continued, setContinued] = useState(false)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pairing = usePairing()
  const transfer = useFileTransfer()
  const webrtc = useWebRTC({
    getSocket: pairing.getSocket,
    roomId: pairing.roomId,
    role: pairing.role === 'sender' ? 'sender' : null,
    active: continued && pairing.status === 'connected',
    onMessage: transfer.handleChannelMessage,
  })

  const openPicker = () => {
    inputRef.current?.click()
  }

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list)
    if (incoming.length === 0) return
    pairing.leave()
    transfer.reset()
    setFiles((prev) => [
      ...prev,
      ...incoming.map((file, i) => ({
        // index + timestamp keeps keys unique even for duplicate names
        id: `${Date.now()}-${prev.length + i}-${file.name}-${file.size}`,
        file,
      })),
    ])
    setContinued(false)
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files)
    // reset so the same file can be selected again
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files)
  }

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((item) => item.id !== id))
  }

  const handleContinue = () => {
    setContinued(true)
    setCopied(false)
    void pairing.createRoom()
  }

  const handleBackToFiles = () => {
    pairing.leave()
    transfer.reset()
    setContinued(false)
  }

  const handleCopyCode = async () => {
    if (!pairing.code) return
    try {
      await navigator.clipboard.writeText(pairing.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0)
  const summary = `${files.length} ${files.length === 1 ? 'file' : 'files'} • ${formatBytes(totalBytes)}`
  // QR payload is connection info only (receive URL + code) — never file contents.
  const pairingUrl = useMemo(
    () => (pairing.code ? buildReceiveUrl(pairing.code) : ''),
    [pairing.code],
  )

  return (
    <section
      aria-label="Send files"
      className="mt-8 w-full rounded-xl border border-border bg-white p-6 sm:p-8"
    >
      <div className="flex items-center justify-center gap-2">
        <h2 className="text-center text-lg font-semibold">Send files</h2>
        {continued && <PairingStatusBadge status={pairing.status} />}
      </div>

      {!continued && (
        <>
          <button
            type="button"
            onClick={openPicker}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            aria-label="Select files by browsing or dropping them here"
            className={`mt-5 w-full rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${
              dragging ? 'border-primary bg-primary/5' : 'border-border bg-background'
            }`}
          >
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
              <Upload size={22} className="text-primary" aria-hidden />
            </span>
            <span className="mt-3 block text-sm font-semibold">Drop files here</span>
            <span className="mt-1 block text-sm text-muted">or browse your device</span>
            <span className="mt-3 block text-xs text-muted">
              Your files are transferred directly.
            </span>
          </button>

          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={handleInputChange}
            className="hidden"
            aria-hidden
            tabIndex={-1}
          />

          {files.length > 0 && (
            <div className="mt-4">
              <ul className="flex flex-col gap-2" aria-label="Selected files">
                {files.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-border">
                      <FileTypeIcon fileName={item.file.name} mimeType={item.file.type} />
                    </span>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-medium" title={item.file.name}>
                        {item.file.name}
                      </p>
                      <p className="text-xs text-muted">{formatBytes(item.file.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(item.id)}
                      aria-label={`Remove ${item.file.name}`}
                      className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-white hover:text-danger"
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>

              <p className="mt-3 text-sm font-medium" aria-live="polite">
                {summary}
              </p>
              <button
                type="button"
                onClick={handleContinue}
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
              >
                Continue <ArrowRight size={16} aria-hidden />
              </button>
            </div>
          )}
        </>
      )}

      {continued && (
        <div className="mt-5 rounded-lg border border-border bg-background p-6 text-center">
          {pairing.status === 'connected' ? (
            <>
              <NetworkStatusPanel
                status={pairing.status}
                localRole="sender"
                localDevice={pairing.localDevice}
                peerDevice={pairing.peerDevice}
              />
              <p className="mt-3 text-xs leading-relaxed text-muted">
                {summary} — paired via code {pairing.code ?? ''}.
              </p>
              <div className="mt-4 border-t border-border pt-4">
                <DirectConnectionPanel
                  rtcStatus={webrtc.rtcStatus}
                  rtcError={webrtc.rtcError}
                  onRetry={webrtc.retry}
                >
                  <TransferSender
                    files={files}
                    transfer={transfer}
                    getChannel={webrtc.getChannel}
                  />
                </DirectConnectionPanel>
              </div>
            </>
          ) : pairing.status === 'disconnected' ? (
            <>
              <p className="text-sm font-semibold text-dark">Connection lost</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {pairing.error ?? 'The other device disconnected.'}
              </p>
              <button
                type="button"
                onClick={() => void pairing.createRoom()}
                className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
              >
                Get a new code
              </button>
            </>
          ) : (
            <>
              <NetworkStatusPanel
                status={pairing.status}
                localRole="sender"
                localDevice={pairing.localDevice}
                peerDevice={pairing.peerDevice}
              />
              {pairing.status !== 'connecting' && pairing.code && (
                <>
                  <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">
                    Scan to connect
                  </p>
                  {pairingUrl && (
                    <div className="mx-auto mt-4 w-fit rounded-xl border border-border bg-white p-3">
                      <QRCode
                        value={pairingUrl}
                        size={168}
                        bgColor="#FFFFFF"
                        fgColor="#0F172A"
                        aria-label={`QR code to connect to this transfer (code ${pairing.code})`}
                      />
                    </div>
                  )}
                  <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-muted">
                    Scan with the receiver&apos;s camera to open the DropLink connection page.
                  </p>
                  <div className="mx-auto mt-4 flex max-w-xs items-center gap-3" aria-hidden>
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Or enter code manually
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <p className="mt-3 font-mono text-4xl font-bold tracking-widest text-dark">
                    {pairing.code}
                  </p>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="mx-auto mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold hover:border-primary hover:text-primary"
                  >
                    {copied ? (
                      <>
                        <Check size={15} aria-hidden /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={15} aria-hidden /> Copy Code
                      </>
                    )}
                  </button>
                </>
              )}
              {pairing.error && (
                <p className="mt-2 text-xs text-danger">{pairing.error}</p>
              )}
            </>
          )}
          <button
            type="button"
            onClick={handleBackToFiles}
            className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold hover:border-primary hover:text-primary"
          >
            Back to files
          </button>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => {
            if (continued) handleBackToFiles()
            else openPicker()
          }}
          className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          Send Files
        </button>
        <button
          type="button"
          onClick={() => {
            pairing.leave()
            transfer.reset()
            onSwitchToReceive()
          }}
          className="flex-1 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
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
