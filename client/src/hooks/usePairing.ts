import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'

export type PairingStatus = 'idle' | 'connecting' | 'waiting' | 'connected' | 'disconnected'
export type PairingRole = 'sender' | 'receiver' | null

type AckResponse = {
  ok: boolean
  roomId?: string
  code?: string
  error?: string
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
  const [error, setError] = useState<string | null>(null)

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

    const socket = io({ autoConnect: false })

    socket.on('peer-joined', () => {
      setStatus('connected')
      setError(null)
    })

    socket.on('peer-disconnected', () => {
      setStatus('disconnected')
    })

    socket.on('room-expired', () => {
      setStatus('disconnected')
      setError('This code has expired. Create a new one and try again.')
    })

    socket.on('disconnect', () => {
      setStatus((prev) => (prev === 'connected' || prev === 'waiting' ? 'disconnected' : prev))
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
    setError(null)
    setRole('sender')
    try {
      const socket = await ensureSocket()
      const res = await new Promise<AckResponse>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Server did not respond.')), 8000)
        socket.emit('create-room', (response: AckResponse) => {
          window.clearTimeout(timer)
          resolve(response)
        })
      })
      if (!res.ok || !res.roomId || !res.code) {
        throw new Error(res.error ?? 'Could not create a room.')
      }
      setRoomId(res.roomId)
      setCode(res.code)
      setStatus('waiting')
    } catch (err) {
      setStatus('disconnected')
      setError(err instanceof Error ? err.message : 'Could not create a room.')
    }
  }, [ensureSocket])

  const joinRoom = useCallback(
    async (rawCode: string) => {
      const normalized = normalizeCode(rawCode)
      if (normalized.length !== 6) {
        setError('Enter the 6-digit code from the sending device.')
        setStatus('disconnected')
        return
      }
      setStatus('connecting')
      setError(null)
      setRole('receiver')
      try {
        const socket = await ensureSocket()
        const res = await new Promise<AckResponse>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error('Server did not respond.')), 8000)
          socket.emit('join-room', { code: normalized }, (response: AckResponse) => {
            window.clearTimeout(timer)
            resolve(response)
          })
        })
        if (!res.ok || !res.roomId) {
          throw new Error(res.error ?? 'Could not join the room.')
        }
        setRoomId(res.roomId)
        setCode(res.code ?? rawCode)
        setStatus('connected')
      } catch (err) {
        setStatus('disconnected')
        setError(err instanceof Error ? err.message : 'Could not join the room.')
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
    setError(null)
  }, [])

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [])

  return { status, role, roomId, code, error, createRoom, joinRoom, leave }
}
