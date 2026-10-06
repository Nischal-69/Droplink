import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { ArrowRight, Check, Copy, Lock, Share2, Upload, X } from 'lucide-react'
import QRCode from 'react-qr-code'
import DirectConnectionPanel from './DirectConnectionPanel'
import FileTypeIcon from './FileTypeIcon'
import NetworkStatusPanel from './NetworkStatusPanel'
import OfflineBanner from './OfflineBanner'
import PairingStatusBadge from './PairingStatusBadge'
import TransferSender from './TransferSender'
import { useFileTransfer } from '../hooks/useFileTransfer'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { usePairing } from '../hooks/usePairing'
import { useWebRTC } from '../hooks/useWebRTC'
import { friendlyError } from '../utils/appErrors'
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
  const [linkCopied, setLinkCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pairing = usePairing()
  const transfer = useFileTransfer()
  const online = useOnlineStatus()
  const pairingErrorCopy = pairing.errorCode ? friendlyError(pairing.errorCode) : null
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
    setLinkCopied(false)
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

  const canNativeShare =
    typeof navigator !== 'undefined' && 'share' in navigator

  const handleShareLink = async () => {
    if (!pairingUrl) return
    if (canNativeShare) {
      try {
        await navigator.share({
          title: 'DropLink transfer',
          text: `Join my DropLink transfer with code ${pairing.code}`,
          url: pairingUrl,
        })
      } catch {
        // User dismissed the sheet — staying on this screen is correct.
      }
      return
    }
    try {
      await navigator.clipboard.writeText(pairingUrl)
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 1500)
    } catch {
      setLinkCopied(false)
    }
  }

  const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0)
  const summary = `${files.length} ${files.length === 1 ? 'file' : 'files'} • ${formatBytes(totalBytes)}`
  // QR payload is connection info only (receive URL + code) — never file contents.
  const pairingUrl = useMemo(
    () => (pairing.code ? buildReceiveUrl(pairing.code) : ''),
    [pairing.code],
  )
  // A localhost QR cannot be opened by phones — nudge toward the LAN address.
  const isLocalhostUrl =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

  // Auto-resume once per interruption episode: when the link is back, the
  // interrupted send continues from the receiver's confirmed offsets.
  const autoResumedRef = useRef(false)
  const { sendState: cardSendState, resumeTransfer: cardResumeTransfer } = transfer
  const { rtcStatus: cardRtcStatus, getChannel: cardGetChannel } = webrtc
  useEffect(() => {
    if (cardSendState !== 'interrupted') {
      autoResumedRef.current = false
      return
    }
    if (cardRtcStatus !== 'open' || autoResumedRef.current) return
    autoResumedRef.current = true
    void cardResumeTransfer(cardGetChannel())
  }, [cardSendState, cardResumeTransfer, cardRtcStatus, cardGetChannel])

  /** Manual recovery: resume now when the link is open, otherwise reconnect first. */
  const handleTransferRetry = () => {
    const channel = webrtc.getChannel()
    if (channel && channel.readyState === 'open') {
      autoResumedRef.current = true
      void transfer.resumeTransfer(channel)
    } else {
      // Let the next reconnect trigger the auto-resume above.
      autoResumedRef.current = false
      webrtc.retry()
    }
  }

  const transferActive =
    transfer.sendState === 'sending' ||
    transfer.sendState === 'resuming' ||
    transfer.sendState === 'interrupted'

  return (
    <section
      aria-label="Send files"
      className="mt-8 w-full rounded-xl border border-border bg-white p-4 sm:p-6"
    >
      <div className="flex items-center justify-center gap-2">
        <h2 className="text-center text-lg font-semibold">Send files</h2>
        {continued && <PairingStatusBadge status={pairing.status} />}
      </div>
      {!online && <OfflineBanner />}

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
            className={`mt-5 w-full rounded-lg border border-dashed px-4 py-10 text-center sm:py-8 ${
              dragging ? 'border-primary bg-primary/5' : 'border-border bg-background'
            }`}
          >
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
              <Upload size={22} className="text-primary" aria-hidden />
            </span>
            <span className="mt-3 hidden text-sm font-semibold sm:block">Drop files here</span>
            <span className="mt-3 block text-base font-semibold sm:hidden">Tap to choose files</span>
            <span className="mt-1 hidden text-sm text-muted sm:block">or browse your device</span>
            <span className="mt-1 block text-sm text-muted sm:hidden">Photos, videos, documents</span>
            <span className="mt-3 block text-xs text-muted">
              Files stay on this device until sent.
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
                      className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg p-1.5 text-muted hover:bg-white hover:text-danger"
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
                disabled={!online}
                title={online ? undefined : 'You appear to be offline'}
                className="mt-2 inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue <ArrowRight size={16} aria-hidden />
              </button>
            </div>
          )}
        </>
      )}

      {continued && (
        <div className="mt-5 rounded-lg border border-border bg-background p-4 text-center sm:p-6">
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
                  rtcErrorCode={webrtc.rtcErrorCode}
                  onRetry={webrtc.retry}
                  transferActive={transferActive}
                  autoRetry={webrtc.autoRetry}
                >
                  <TransferSender
                    files={files}
                    transfer={transfer}
                    getChannel={webrtc.getChannel}
                    channelOpen={webrtc.rtcStatus === 'open'}
                    onRetry={handleTransferRetry}
                  />
                </DirectConnectionPanel>
              </div>
            </>
          ) : pairing.status === 'disconnected' ? (
            <div aria-live="polite">
              <p className="text-sm font-semibold text-dark">
                {pairingErrorCopy?.title ?? 'The other device disconnected.'}
              </p>
              {pairingErrorCopy?.hint && (
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
                  {pairingErrorCopy.hint}
                </p>
              )}
              <button
                type="button"
                onClick={() => void pairing.createRoom()}
                disabled={!online}
                title={online ? undefined : 'You appear to be offline'}
                className="mt-4 min-h-[48px] w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Get a new code
              </button>
            </div>
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
                    <div className="mx-auto mt-4 w-fit max-w-full rounded-xl border border-border bg-white p-3">
                      <QRCode
                        value={pairingUrl}
                        size={192}
                        bgColor="#FFFFFF"
                        fgColor="#0F172A"
                        style={{ height: 'auto', width: '100%', maxWidth: '192px' }}
                        aria-label={`QR code to connect to this transfer (code ${pairing.code})`}
                      />
                    </div>
                  )}
                  <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-muted">
                    Scan with the receiver&apos;s camera to open the DropLink connection page.
                  </p>
                  {isLocalhostUrl && (
                    <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-muted" role="note">
                      You opened this page via localhost, so phones can&apos;t use this QR.
                      Reopen it via your LAN address (e.g. http://192.168.1.72:5173) and get
                      a fresh code.
                    </p>
                  )}
                  <div className="mx-auto mt-4 flex max-w-xs items-center gap-3" aria-hidden>
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Or enter code manually
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <p className="mt-3 font-mono text-3xl font-bold tracking-widest text-dark sm:text-4xl">
                    {pairing.code}
                  </p>
                  <div className="mx-auto mt-3 flex w-full max-w-xs flex-col gap-2 sm:flex-row sm:justify-center">
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
                    >
                      {copied ? (
                        <>
                          <Check size={16} aria-hidden /> Copied
                        </>
                      ) : (
                        <>
                          <Copy size={16} aria-hidden /> Copy Code
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleShareLink}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
                    >
                      {linkCopied ? (
                        <>
                          <Check size={16} aria-hidden /> Link copied
                        </>
                      ) : (
                        <>
                          <Share2 size={16} aria-hidden />{' '}
                          {canNativeShare ? 'Share link' : 'Copy link'}
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
              {pairingErrorCopy && (
                <div className="mt-2" aria-live="polite">
                  <p className="text-xs font-semibold text-dark">{pairingErrorCopy.title}</p>
                  {pairingErrorCopy.hint && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">{pairingErrorCopy.hint}</p>
                  )}
                </div>
              )}
            </>
          )}
          <button
            type="button"
            onClick={handleBackToFiles}
            className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold hover:border-primary hover:text-primary"
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
          className="min-h-[48px] flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
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
          className="min-h-[48px] flex-1 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
        >
          Receive Files
        </button>
      </div>

      <p className="mt-5 flex items-start justify-center gap-1.5 text-center text-xs leading-relaxed text-muted">
        <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
        No cloud storage · Direct transfer
      </p>
    </section>
  )
}
