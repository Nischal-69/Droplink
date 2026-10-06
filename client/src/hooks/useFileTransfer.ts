import { useCallback, useEffect, useRef, useState } from 'react'
import {
  classifyTransferFailure,
  type ErrorCode,
} from '../utils/appErrors'
import {
  PROGRESS_THROTTLE_MS,
  TransferInterruptedError,
  clampResumeOffset,
  decodeControl,
  encodeControl,
  sanitizeFileName,
  sanitizeMimeType,
  transferFiles,
  truncateParts,
} from '../utils/transferProtocol'
import { Speedometer } from '../utils/transferStats'

export type SendState = 'idle' | 'sending' | 'resuming' | 'interrupted' | 'done' | 'error' | 'cancelled'

export type SendProgress = {
  sentBytes: number
  done: boolean
  /** Measured bytes/sec from actual chunk flow. */
  bps: number
}

export type ReceivedFile = {
  fileId: string
  name: string
  size: number
  mime: string
  receivedBytes: number
  done: boolean
  cancelled: boolean
  /** Listed from the queue manifest but transfer has not started yet. */
  waiting: boolean
  blobUrl: string | null
  /** Reconstructed file bytes kept locally for single + ZIP downloads. */
  blob: Blob | null
  /** Measured bytes/sec from actual chunk flow. */
  bps: number
}

type OutgoingFile = {
  id: string
  file: File
}

type IncomingAssembly = {
  fileId: string
  transferId: string
  name: string
  size: number
  mime: string
  parts: ArrayBuffer[]
  received: number
  cancelled: boolean
  finalized: boolean
}

/** Receiver has this long to answer a resume query before resume is abandoned. */
const RESUME_QUERY_TIMEOUT_MS = 8000

/**
 * Ask the receiver how many bytes of each file it durably holds, so a
 * resumed send continues from the last confirmed chunk instead of zero.
 * Rejects with TransferInterruptedError on timeout or a dead channel.
 */
function queryResumeOffsets(
  channel: { readonly readyState: string; send(data: string): void },
  transferId: string,
  files: { id: string; file: { name: string; size: number } }[],
  pending: Map<string, (receivedBytes: number) => void>,
  timeoutMs = RESUME_QUERY_TIMEOUT_MS,
): Promise<Record<string, number>> {
  const jobs = files.map(
    ({ id: fileId, file }) =>
      new Promise<[string, number]>((resolve, reject) => {
        const key = `${transferId}:${fileId}`
        const timer = globalThis.setTimeout(() => {
          pending.delete(key)
          reject(new TransferInterruptedError(`No resume answer for "${file.name}".`))
        }, timeoutMs)
        pending.set(key, (receivedBytes: number) => {
          globalThis.clearTimeout(timer)
          pending.delete(key)
          resolve([fileId, clampResumeOffset(receivedBytes, file.size)])
        })
        try {
          if (channel.readyState !== 'open') throw new TransferInterruptedError()
          channel.send(encodeControl({ kind: 'resume-query', transferId, fileId }))
        } catch {
          globalThis.clearTimeout(timer)
          pending.delete(key)
          reject(new TransferInterruptedError())
        }
      }),
  )
  return Promise.all(jobs).then((entries) => Object.fromEntries(entries))
}

/**
 * File transfer over an already-open WebRTC DataChannel.
 * - Sender reads one CHUNK_SIZE slice at a time (huge files never fully
 *   loaded) and honors backpressure via bufferedAmount.
 * - Receiver reassembles parts into a Blob preserving name/type/size.
 * - No server involvement: bytes only ever go through `channel.send`.
 */
export function useFileTransfer() {
  const [sendState, setSendState] = useState<SendState>('idle')
  /** User-facing failure code only — technical detail goes to console.debug. */
  const [sendErrorCode, setSendErrorCode] = useState<ErrorCode | null>(null)
  /** Receiver-side failure (e.g. file reconstruction ran out of memory). */
  const [receiveErrorCode, setReceiveErrorCode] = useState<ErrorCode | null>(null)
  const [sendProgress, setSendProgress] = useState<Record<string, SendProgress>>({})
  /** True while the sender has paused chunk emission (offset preserved). */
  const [sendPaused, setSendPaused] = useState(false)
  const [received, setReceived] = useState<ReceivedFile[]>([])
  /** True while the sender has paused (set via `transfer-pause` frames). */
  const [receivePaused, setReceivePaused] = useState(false)

  const abortRef = useRef(false)
  const pausedRef = useRef(false)
  /** True while our own send loop is running (to honor a peer's cancel). */
  const sendActiveRef = useRef(false)
  /** Transfer id of the active outgoing transfer (for pause/resume frames). */
  const outgoingTransferIdRef = useRef<string | null>(null)
  /** Transfer id of the active incoming transfer (for receiver cancel). */
  const incomingTransferIdRef = useRef<string | null>(null)
  /** Channel used for receiver-side control frames (resume answers, cancel). */
  const peerChannelRef = useRef<{ send(data: string): void } | null>(null)
  /** Snapshot of an interrupted send so it can be resumed from confirmed offsets. */
  const interruptedRef = useRef<{ transferId: string; files: OutgoingFile[] } | null>(null)
  /** Bumped on reset/fresh send so stale resume queries can't act afterwards. */
  const epochRef = useRef(0)
  /** Pending resume-query resolvers keyed by `transferId:fileId`. */
  const pendingResumeRef = useRef(new Map<string, (receivedBytes: number) => void>())
  const incomingRef = useRef(new Map<string, IncomingAssembly>())
  const openFileRef = useRef<string | null>(null)
  const progressTickRef = useRef(0)
  const sendMeterRef = useRef<{ fileId: string; meter: Speedometer } | null>(null)
  const receiveMeterRef = useRef<{ fileId: string; meter: Speedometer } | null>(null)

  const revokeAll = useCallback(() => {
    setReceived((prev) => {
      for (const item of prev) {
        if (item.blobUrl) URL.revokeObjectURL(item.blobUrl)
      }
      return []
    })
  }, [])

  /** Full reset: revoke downloads, clear progress, abort any send. */
  const reset = useCallback(() => {
    abortRef.current = true
    pausedRef.current = false
    sendActiveRef.current = false
    epochRef.current += 1
    outgoingTransferIdRef.current = null
    incomingTransferIdRef.current = null
    peerChannelRef.current = null
    interruptedRef.current = null
    for (const resolve of pendingResumeRef.current.values()) resolve(-1)
    pendingResumeRef.current.clear()
    incomingRef.current.clear()
    openFileRef.current = null
    revokeAll()
    setSendProgress({})
    setSendState('idle')
    setSendErrorCode(null)
    setReceiveErrorCode(null)
    setSendPaused(false)
    setReceivePaused(false)
  }, [revokeAll])

  useEffect(() => {
    return () => {
      for (const item of incomingRef.current.values()) {
        item.parts = []
      }
      incomingRef.current.clear()
    }
  }, [])

  const finalizeFile = useCallback((fileId: string) => {
    const assembly = incomingRef.current.get(fileId)
    if (!assembly || assembly.cancelled || assembly.finalized) return
    let blob: Blob
    try {
      // Assembling a huge file can exceed what the browser will allocate.
      blob = new Blob(assembly.parts, {
        type: assembly.mime || 'application/octet-stream',
      })
    } catch (error) {
      // Free the partial buffers, reset honest progress, and surface a
      // plain-language error. A later resend can still complete the file.
      assembly.parts = []
      assembly.received = 0
      if (openFileRef.current === fileId) openFileRef.current = null
      setReceived((prev) =>
        prev.map((item) =>
          item.fileId === fileId ? { ...item, receivedBytes: 0, bps: 0 } : item,
        ),
      )
      setReceiveErrorCode(classifyTransferFailure(error))
      return
    }
    assembly.finalized = true
    const blobUrl = URL.createObjectURL(blob)
    assembly.parts = []
    if (openFileRef.current === fileId) openFileRef.current = null
    setReceived((prev) =>
      prev.map((item) =>
        item.fileId === fileId
          ? { ...item, receivedBytes: assembly.received, done: true, blobUrl, blob, bps: 0, waiting: false }
          : item,
      ),
    )
  }, [])

  /**
   * Channel used for receiver-side control frames (resume answers, cancel).
   * Synced from the live DataChannel by the hosting card.
   */
  const setPeerChannel = useCallback((channel: { send(data: string): void } | null) => {
    peerChannelRef.current = channel
  }, [])

  const pushProgress = useCallback(
    (fileId: string, receivedBytes: number, done: boolean) => {
      let slot = receiveMeterRef.current
      if (!slot || slot.fileId !== fileId) {
        slot = { fileId, meter: new Speedometer() }
        receiveMeterRef.current = slot
      }
      const bps = done ? 0 : slot.meter.push(receivedBytes)
      const now = Date.now()
      if (!done && now - progressTickRef.current < PROGRESS_THROTTLE_MS) return
      progressTickRef.current = now
      setReceived((prev) =>
        prev.map((item) =>
          item.fileId === fileId ? { ...item, receivedBytes, done, bps } : item,
        ),
      )
    },
    [],
  )

  const appendBinary = useCallback(
    (buffer: ArrayBuffer) => {
      const fileId = openFileRef.current
      if (!fileId) return
      const assembly = incomingRef.current.get(fileId)
      if (!assembly || assembly.cancelled || assembly.finalized) return
      assembly.parts.push(buffer)
      assembly.received += buffer.byteLength
      if (assembly.received >= assembly.size) {
        pushProgress(fileId, assembly.received, true)
        finalizeFile(fileId)
      } else {
        pushProgress(fileId, assembly.received, false)
      }
    },
    [finalizeFile, pushProgress],
  )

  /** Message handler to plug into the DataChannel (`onmessage`). */
  const handleChannelMessage = useCallback(
    (event: MessageEvent) => {
      const data: unknown = event.data
      if (typeof data === 'string') {
        const message = decodeControl(data)
        if (!message) return
        switch (message.kind) {
          case 'file-start': {
            const existing = incomingRef.current.get(message.fileId)
            // Peer metadata is never trusted blindly: sanitize before storing.
            const safeName = sanitizeFileName(message.name)
            const safeMime = sanitizeMimeType(message.mime)
            if (existing && existing.transferId === message.transferId && !existing.cancelled) {
              if (existing.finalized) {
                // Duplicate announce for an already-complete file — keep the download.
                break
              }
              // Same-transfer resume: keep confirmed bytes, trim anything past
              // the sender's offset so the prefix stays exact.
              const resumeOffset = clampResumeOffset(message.offset ?? 0, message.size)
              const trimmed = truncateParts(existing.parts, existing.received, resumeOffset)
              existing.parts = trimmed.parts
              existing.received = trimmed.receivedBytes
              existing.name = safeName
              existing.size = message.size
              existing.mime = safeMime
              openFileRef.current = message.fileId
              setReceived((prev) =>
                prev.map((item) =>
                  item.fileId === message.fileId
                    ? {
                        ...item,
                        name: safeName,
                        size: message.size,
                        mime: safeMime,
                        receivedBytes: trimmed.receivedBytes,
                        done: false,
                        cancelled: false,
                        waiting: false,
                        bps: 0,
                      }
                    : item,
                ),
              )
              if (message.size === 0) finalizeFile(message.fileId)
              break
            }
            // Fresh start (new transfer, restarted file, or unknown assembly).
            incomingRef.current.set(message.fileId, {
              fileId: message.fileId,
              transferId: message.transferId,
              name: safeName,
              size: message.size,
              mime: safeMime,
              parts: [],
              received: 0,
              cancelled: false,
              finalized: false,
            })
            openFileRef.current = message.fileId
            setReceived((prev) => {
              const entry = {
                fileId: message.fileId,
                name: safeName,
                size: message.size,
                mime: safeMime,
                receivedBytes: 0,
                done: message.size === 0,
                cancelled: false,
                waiting: false,
                blobUrl: null,
                blob: null,
                bps: 0,
              }
              const found = prev.find((item) => item.fileId === message.fileId)
              // Never clobber a completed download with a stale announce.
              if (found?.done && !found.cancelled) return prev
              if (found) {
                return prev.map((item) => (item.fileId === message.fileId ? entry : item))
              }
              return [...prev, entry]
            })
            if (message.size === 0) finalizeFile(message.fileId)
            break
          }
          case 'queue': {
            // Complete manifest up front — the full queue is visible immediately.
            setReceived((prev) => {
              const known = new Set(prev.map((item) => item.fileId))
              const additions = message.files
                .filter((entry) => !known.has(entry.fileId))
                .map((entry) => ({
                  fileId: entry.fileId,
                  name: sanitizeFileName(entry.name),
                  size: entry.size,
                  mime: sanitizeMimeType(entry.mime),
                  receivedBytes: 0,
                  done: false,
                  cancelled: false,
                  waiting: true,
                  blobUrl: null,
                  blob: null,
                  bps: 0,
                }))
              return additions.length > 0 ? [...prev, ...additions] : prev
            })
            break
          }
          case 'file-end':
            finalizeFile(message.fileId)
            break
          case 'transfer-complete': {
            const openId = openFileRef.current
            if (openId) finalizeFile(openId)
            setReceivePaused(false)
            break
          }
          case 'transfer-pause':
            // Sender froze chunk emission; bytes stall until `transfer-resume`.
            receiveMeterRef.current = null
            setReceivePaused(true)
            break
          case 'transfer-resume':
            receiveMeterRef.current = null
            setReceivePaused(false)
            break
          case 'transfer-cancel': {
            setReceivePaused(false)
            // A peer's cancel stops our own send loop too (own cancel frames
            // never loop back over the channel, so this can't self-trigger).
            if (sendActiveRef.current) {
              abortRef.current = true
            }
            const target = message.fileId ?? openFileRef.current
            if (target) {
              const assembly = incomingRef.current.get(target)
              // Never let a late cancel nuke a completed download.
              if (assembly && !assembly.finalized) {
                assembly.cancelled = true
                assembly.parts = []
              }
              if (openFileRef.current === target) openFileRef.current = null
              setReceived((prev) =>
                prev.map((item) =>
                  item.fileId === target && !item.done
                    ? { ...item, cancelled: true, waiting: false }
                    : item,
                ),
              )
            }
            break
          }
          case 'resume-query': {
            // Report durably-held bytes so the sender resumes from the last
            // confirmed chunk. Unknown/cancelled files answer 0 (full resend).
            const assembly = incomingRef.current.get(message.fileId)
            const held =
              assembly &&
              assembly.transferId === message.transferId &&
              !assembly.cancelled
                ? Math.min(assembly.received, assembly.size)
                : 0
            try {
              peerChannelRef.current?.send(
                encodeControl({
                  kind: 'resume-state',
                  transferId: message.transferId,
                  fileId: message.fileId,
                  receivedBytes: held,
                }),
              )
            } catch {
              // Sender will time out and stay interrupted — retryable.
            }
            break
          }
          case 'resume-state': {
            const key = `${message.transferId}:${message.fileId}`
            pendingResumeRef.current.get(key)?.(message.receivedBytes)
            break
          }
          case 'transfer-start':
            // A fresh transfer clears any stale paused display.
            incomingTransferIdRef.current = message.transferId
            setReceivePaused(false)
            break
        }
        return
      }
      if (data instanceof ArrayBuffer) {
        appendBinary(data)
        return
      }
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        // Some browsers deliver binary frames as Blobs — convert without copying more than once.
        void data.arrayBuffer().then((buffer) => appendBinary(buffer))
      }
    },
    [appendBinary, finalizeFile],
  )

  const cancelSend = useCallback(() => {
    abortRef.current = true
    pausedRef.current = false
    setSendPaused(false)
  }, [])

  /**
   * Real pause: the send loop stops emitting chunks and holds its exact
   * byte offset; the peer is notified so it can show the paused state.
   */
  const pauseSend = useCallback(
    (channel: RTCDataChannel | null) => {
      if ((sendState !== 'sending' && sendState !== 'resuming') || pausedRef.current) return
      pausedRef.current = true
      setSendPaused(true)
      // Freeze the live speed readout — no bytes are flowing.
      sendMeterRef.current = null
      setSendProgress((prev) => {
        const next = { ...prev }
        for (const key of Object.keys(next)) {
          if (!next[key].done) next[key] = { ...next[key], bps: 0 }
        }
        return next
      })
      try {
        channel?.send(
          encodeControl({ kind: 'transfer-pause', transferId: outgoingTransferIdRef.current ?? 'unknown' }),
        )
      } catch {
        // Frame is advisory; the local loop is genuinely paused regardless.
      }
    },
    [sendState],
  )

  /** Resume a paused send from the preserved offset. */
  const resumeSend = useCallback(
    (channel: RTCDataChannel | null) => {
      if ((sendState !== 'sending' && sendState !== 'resuming') || !pausedRef.current) return
      pausedRef.current = false
      setSendPaused(false)
      sendMeterRef.current = null
      try {
        channel?.send(
          encodeControl({ kind: 'transfer-resume', transferId: outgoingTransferIdRef.current ?? 'unknown' }),
        )
      } catch {
        // Frame is advisory; the local loop genuinely resumes regardless.
      }
    },
    [sendState],
  )

  /**
   * Receiver-side cancel: tell the sender to stop, then drop partial
   * buffers and mark in-flight files cancelled. Finished downloads are
   * kept; only temporary transfer data is cleared.
   */
  const cancelReceive = useCallback((channel: RTCDataChannel | null) => {
    try {
      channel?.send(
        encodeControl({ kind: 'transfer-cancel', transferId: incomingTransferIdRef.current ?? 'unknown' }),
      )
    } catch {
      // Link may already be down — still clean up locally.
    }
    receiveMeterRef.current = null
    setReceivePaused(false)
    for (const assembly of incomingRef.current.values()) {
      assembly.cancelled = true
      assembly.parts = []
    }
    incomingRef.current.clear()
    openFileRef.current = null
    setReceived((prev) =>
      prev.map((item) =>
        item.done || item.cancelled ? item : { ...item, cancelled: true, waiting: false, bps: 0 },
      ),
    )
  }, [])

  /** Clear the receiver-side error banner (failed partials stay resumable). */
  const dismissReceiveError = useCallback(() => {
    setReceiveErrorCode(null)
  }, [])

  const reportSendProgress = useCallback((fileId: string, sentBytes: number, done: boolean) => {
    let slot = sendMeterRef.current
    if (!slot || slot.fileId !== fileId) {
      slot = { fileId, meter: new Speedometer() }
      sendMeterRef.current = slot
    }
    const bps = done ? 0 : slot.meter.push(sentBytes)
    const now = Date.now()
    if (!done && now - progressTickRef.current < PROGRESS_THROTTLE_MS) return
    progressTickRef.current = now
    setSendProgress((prev) => ({ ...prev, [fileId]: { sentBytes, done, bps } }))
  }, [])

  const sendFiles = useCallback(async (channel: RTCDataChannel | null, files: OutgoingFile[]) => {
    if (!channel || channel.readyState !== 'open') {
      setSendErrorCode('transfer-failed')
      setSendState('error')
      return
    }
    if (files.length === 0) return
    abortRef.current = false
    pausedRef.current = false
    setSendPaused(false)
    sendActiveRef.current = true
    epochRef.current += 1
    outgoingTransferIdRef.current = null
    interruptedRef.current = null
    setSendErrorCode(null)
    setSendState('sending')
    setSendProgress(
      Object.fromEntries(files.map(({ id }) => [id, { sentBytes: 0, done: false, bps: 0 }])),
    )

    try {
      const outcome = await transferFiles(channel, files, {
        isAborted: () => abortRef.current,
        isPaused: () => pausedRef.current,
        onProgress: reportSendProgress,
        onTransferId: (transferId) => {
          outgoingTransferIdRef.current = transferId
        },
      })
      setSendPaused(false)
      outgoingTransferIdRef.current = null
      interruptedRef.current = null
      setSendState(outcome.status === 'done' ? 'done' : 'cancelled')
    } catch (error) {
      if (error instanceof TransferInterruptedError) {
        // Connection dropped mid-transfer: keep progress + files so resume
        // can continue from the last confirmed chunk.
        interruptedRef.current = {
          transferId: outgoingTransferIdRef.current ?? `tx-${Date.now()}`,
          files,
        }
        setSendPaused(false)
        setSendErrorCode(null)
        setSendState('interrupted')
      } else {
        outgoingTransferIdRef.current = null
        interruptedRef.current = null
        setSendErrorCode(classifyTransferFailure(error))
        setSendState('error')
      }
    } finally {
      sendActiveRef.current = false
      pausedRef.current = false
    }
  }, [reportSendProgress])

  /**
   * Resume an interrupted send on a fresh channel: ask the receiver what it
   * durably holds per file, then continue each file from that confirmed
   * offset under the same transfer id. Completed files are verified, not
   * re-sent; only genuinely missing bytes travel again.
   */
  const resumeTransfer = useCallback(async (channel: RTCDataChannel | null) => {
    const snapshot = interruptedRef.current
    if (!snapshot || sendState !== 'interrupted') return
    if (!channel || channel.readyState !== 'open') return
    const epoch = epochRef.current
    const { transferId, files } = snapshot
    outgoingTransferIdRef.current = transferId
    sendActiveRef.current = true
    abortRef.current = false
    setSendErrorCode(null)
    setSendState('resuming')
    sendMeterRef.current = null
    try {
      const offsets = await queryResumeOffsets(channel, transferId, files, pendingResumeRef.current)
      if (epoch !== epochRef.current) return
      if (abortRef.current) {
        try {
          channel.send(encodeControl({ kind: 'transfer-cancel', transferId }))
        } catch {
          // Link state already handled by the interrupted snapshot.
        }
        interruptedRef.current = null
        outgoingTransferIdRef.current = null
        setSendState('cancelled')
        return
      }
      const outcome = await transferFiles(channel, files, {
        transferId,
        startOffsets: offsets,
        isAborted: () => abortRef.current,
        isPaused: () => pausedRef.current,
        onProgress: reportSendProgress,
        onTransferId: (id) => {
          outgoingTransferIdRef.current = id
        },
      })
      if (epoch !== epochRef.current) return
      setSendPaused(false)
      outgoingTransferIdRef.current = null
      interruptedRef.current = null
      setSendState(outcome.status === 'done' ? 'done' : 'cancelled')
    } catch (error) {
      if (epoch !== epochRef.current) return
      if (error instanceof TransferInterruptedError) {
        // Still recoverable: progress (including resume gains, already
        // reported via onProgress) is preserved for another attempt.
        setSendPaused(false)
        setSendState('interrupted')
      } else {
        interruptedRef.current = null
        outgoingTransferIdRef.current = null
        setSendErrorCode(classifyTransferFailure(error))
        setSendState('error')
      }
    } finally {
      sendActiveRef.current = false
      pausedRef.current = false
    }
  }, [reportSendProgress, sendState])

  return {
    sendState,
    sendErrorCode,
    sendProgress,
    sendPaused,
    received,
    receivePaused,
    receiveErrorCode,
    sendFiles,
    resumeTransfer,
    setPeerChannel,
    pauseSend,
    resumeSend,
    cancelSend,
    cancelReceive,
    dismissReceiveError,
    handleChannelMessage,
    reset,
  }
}

export type FileTransfer = ReturnType<typeof useFileTransfer>
