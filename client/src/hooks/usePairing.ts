import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  classifySignalFailure,
  codeFromServerMessage,
  type ErrorCode,
} from '../utils/appErrors'
import { getLocalDeviceLabel, sanitizeDeviceLabel } from '../utils/deviceInfo'

export type PairingStatus = 'idle' | 'connecting' | 'waiting' | 'connected' | 'disconnected'
export type PairingRole = 'sender' | 'receiver' | null

type AckResponse = {
  ok: boolean
  roomId?: string
  code?: string
  /** Friendly peer label (e.g. "Chrome on Android") — display only, never an IP. */
  hostDevice?: string | null
  error?: string
}

type PeerJoinedPayload = {
  roomId?: string
  peerId?: string
  /** Friendly peer label (e.g. "Chrome on Windows") — display only, never an IP. */
  device?: string | null
}

function normalizeCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, 6)
}

/**
 * Socket.IO pairing hook (signaling only — file bytes never touch the socket).
 * - Sender: createRoom() -> gets { roomId, code }, status "waiting" until peer joins.
 * - Receiver: joinRoom(code) -> status "connecting" then "connected" or "disconnected".
 * The socket connects lazily on the first pairing action, not on page load.
 */
export function usePairing() {
  const socketRef = useRef<Socket | null>(null)
  const [status, setStatus] = useState<PairingStatus>('idle')
  const [role, setRole] = useState<PairingRole>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  /** User-facing failure code only — technical detail goes to console.debug. */
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null)
  /** This device's friendly label, e.g. "Chrome on Windows". */
  const [localDevice] = useState(() => getLocalDeviceLabel())
  /** The paired peer's friendly label, e.g. "Chrome on Android" (null until joined). */
  const [peerDevice, setPeerDevice] = useState<string | null>(null)
  const statusRef = useRef<PairingStatus>('idle')
  useEffect(() => {
    statusRef.current = status
  }, [status])

  const ensureSocket = useCallback((): Promise<Socket> => {
    const existing = socketRef.current
    if (existing) {
      if (existing.connected) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          cleanup()
          reject(new Error('Could not reach the signaling server.'))
        }, 8000)
        const onConnect = () => {
          cleanup()
          resolve(existing)
        }
        const onError = () => {
          cleanup()
          reject(new Error('Could not reach the signaling server.'))
        }
        const cleanup = () => {
          window.clearTimeout(timer)
          existing.off('connect', onConnect)
          existing.off('connect_error', onError)
        }
        existing.once('connect', onConnect)
        existing.once('connect_error', onError)
        existing.connect()
      })
    }

    // Same-origin connection: no URL is hardcoded, so a page served over
    // HTTPS automatically uses a secure WebSocket (WSS) for signaling.
    // File bytes never travel here regardless of transport.
    const socket = io({ autoConnect: false })

    socket.on('peer-joined', (payload: PeerJoinedPayload) => {
      setStatus('connected')
      setErrorCode(null)
      setPeerDevice(sanitizeDeviceLabel(payload?.device))
    })

    socket.on('peer-disconnected', () => {
      setStatus('disconnected')
      setErrorCode('peer-disconnected')
    })

    socket.on('room-expired', () => {
      setStatus('disconnected')
      setErrorCode('code-expired')
    })

    socket.on('disconnect', () => {
      const prev = statusRef.current
      if (prev === 'connected' || prev === 'waiting') {
        setStatus('disconnected')
        setErrorCode(classifySignalFailure(new Error('signaling socket disconnected')))
      }
    })

    socketRef.current = socket
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup()
        reject(new Error('Could not reach the signaling server.'))
      }, 8000)
      const onConnect = () => {
        cleanup()
        resolve(socket)
      }
      const onError = () => {
        cleanup()
        reject(new Error('Could not reach the signaling server.'))
      }
      const cleanup = () => {
        window.clearTimeout(timer)
        socket.off('connect', onConnect)
        socket.off('connect_error', onError)
      }
      socket.once('connect', onConnect)
      socket.once('connect_error', onError)
      socket.connect()
    })
  }, [])

  const createRoom = useCallback(async () => {
    setStatus('connecting')
    setErrorCode(null)
    setRole('sender')
    try {
      const socket = await ensureSocket()
      const res = await new Promise<AckResponse>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Server did not respond.')), 8000)
        socket.emit('create-room', { device: getLocalDeviceLabel() }, (response: AckResponse) => {
          window.clearTimeout(timer)
          resolve(response)
        })
      })
      if (!res.ok || !res.roomId || !res.code) {
        setStatus('disconnected')
        setErrorCode(codeFromServerMessage(res.error))
        return
      }
      setRoomId(res.roomId)
      setCode(res.code)
      setStatus('waiting')
    } catch (err) {
      setStatus('disconnected')
      setErrorCode(classifySignalFailure(err))
    }
  }, [ensureSocket])

  const joinRoom = useCallback(
    async (rawCode: string) => {
      const normalized = normalizeCode(rawCode)
      if (normalized.length !== 6) {
        setErrorCode('code-invalid')
        setStatus('disconnected')
        return
      }
      setStatus('connecting')
      setErrorCode(null)
      setRole('receiver')
      try {
        const socket = await ensureSocket()
        const res = await new Promise<AckResponse>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error('Server did not respond.')), 8000)
          socket.emit(
            'join-room',
            { code: normalized, device: getLocalDeviceLabel() },
            (response: AckResponse) => {
              window.clearTimeout(timer)
              resolve(response)
            },
          )
        })
        if (!res.ok || !res.roomId) {
          setStatus('disconnected')
          setErrorCode(codeFromServerMessage(res.error))
          return
        }
        setRoomId(res.roomId)
        setCode(res.code ?? rawCode)
        setPeerDevice(sanitizeDeviceLabel(res.hostDevice))
        setStatus('connected')
      } catch (err) {
        setStatus('disconnected')
        setErrorCode(classifySignalFailure(err))
      }
    },
    [ensureSocket],
  )

  const leave = useCallback(() => {
    socketRef.current?.emit('leave-room')
    setStatus('idle')
    setRole(null)
    setRoomId(null)
    setCode(null)
    setErrorCode(null)
    setPeerDevice(null)
  }, [])

  /** Raw signaling socket for WebRTC handshake (signaling only). */
  const getSocket = useCallback((): Socket | null => socketRef.current, [])

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [])

  return { status, role, roomId, code, errorCode, localDevice, peerDevice, createRoom, joinRoom, leave, getSocket }
}
