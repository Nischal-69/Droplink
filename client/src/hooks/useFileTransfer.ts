import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PROGRESS_THROTTLE_MS,
  decodeControl,
  transferFiles,
} from '../utils/transferProtocol'
import { Speedometer } from '../utils/transferStats'

export type SendState = 'idle' | 'sending' | 'done' | 'error' | 'cancelled'

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
  /** Measured bytes/sec from actual chunk flow. */
  bps: number
}

type OutgoingFile = {
  id: string
  file: File
}

type IncomingAssembly = {
  fileId: string
  name: string
  size: number
  mime: string
  parts: BlobPart[]
  received: number
  cancelled: boolean
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
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendProgress, setSendProgress] = useState<Record<string, SendProgress>>({})
  const [received, setReceived] = useState<ReceivedFile[]>([])

  const abortRef = useRef(false)
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
    incomingRef.current.clear()
    openFileRef.current = null
    revokeAll()
    setSendProgress({})
    setSendState('idle')
    setSendError(null)
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
    if (!assembly || assembly.cancelled) return
    const blob = new Blob(assembly.parts, {
      type: assembly.mime || 'application/octet-stream',
    })
    const blobUrl = URL.createObjectURL(blob)
    assembly.parts = []
    if (openFileRef.current === fileId) openFileRef.current = null
    setReceived((prev) =>
      prev.map((item) =>
        item.fileId === fileId
          ? { ...item, receivedBytes: assembly.received, done: true, blobUrl, bps: 0, waiting: false }
          : item,
      ),
    )
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
      if (!assembly || assembly.cancelled) return
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
            incomingRef.current.set(message.fileId, {
              fileId: message.fileId,
              name: message.name,
              size: message.size,
              mime: message.mime,
              parts: [],
              received: 0,
              cancelled: false,
            })
            openFileRef.current = message.fileId
            setReceived((prev) => {
              const entry = {
                fileId: message.fileId,
                name: message.name,
                size: message.size,
                mime: message.mime,
                receivedBytes: 0,
                done: message.size === 0,
                cancelled: false,
                waiting: false,
                blobUrl: null,
                bps: 0,
              }
              if (prev.some((item) => item.fileId === message.fileId)) {
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
                  name: entry.name,
                  size: entry.size,
                  mime: entry.mime,
                  receivedBytes: 0,
                  done: false,
                  cancelled: false,
                  waiting: true,
                  blobUrl: null,
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
            break
          }
          case 'transfer-cancel': {
            const target = message.fileId ?? openFileRef.current
            if (target) {
              const assembly = incomingRef.current.get(target)
              if (assembly) {
                assembly.cancelled = true
                assembly.parts = []
              }
              if (openFileRef.current === target) openFileRef.current = null
              setReceived((prev) =>
                prev.map((item) =>
                  item.fileId === target ? { ...item, cancelled: true, waiting: false } : item,
                ),
              )
            }
            break
          }
          case 'transfer-start':
            // Informational only — files arrive via file-start frames.
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
  }, [])

  const sendFiles = useCallback(async (channel: RTCDataChannel | null, files: OutgoingFile[]) => {
    if (!channel || channel.readyState !== 'open') {
      setSendError('Direct connection is not open.')
      setSendState('error')
      return
    }
    if (files.length === 0) return
    abortRef.current = false
    setSendError(null)
    setSendState('sending')
    setSendProgress(
      Object.fromEntries(files.map(({ id }) => [id, { sentBytes: 0, done: false, bps: 0 }])),
    )

    const markProgress = (fileId: string, sentBytes: number, done: boolean) => {
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
    }

    try {
      const outcome = await transferFiles(channel, files, {
        isAborted: () => abortRef.current,
        onProgress: markProgress,
      })
      setSendState(outcome.status === 'done' ? 'done' : 'cancelled')
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Transfer failed.')
      setSendState('error')
    }
  }, [])

  return {
    sendState,
    sendError,
    sendProgress,
    received,
    sendFiles,
    cancelSend,
    handleChannelMessage,
    reset,
  }
}

export type FileTransfer = ReturnType<typeof useFileTransfer>
