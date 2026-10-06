import { useCallback, useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'

export type RtcStatus = 'idle' | 'signaling' | 'connecting' | 'open' | 'failed' | 'closed'
export type WebRTCRole = 'sender' | 'receiver' | null

type SignalMessage = {
  type: 'offer' | 'answer' | 'ice' | 'restart-request'
  payload?: unknown
  from?: string
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

export const DATA_CHANNEL_LABEL = 'droplink-files'
const OPEN_TIMEOUT_MS = 30000
/** Bounded automatic reconnection attempts after a drop (manual retry is unlimited). */
const MAX_AUTO_RETRIES = 5
const autoRetryDelayMs = (attempt: number) => 1000 * 2 ** attempt

export type AutoRetryState = {
  /** True while a reconnection attempt is scheduled or the fresh handshake is running. */
  active: boolean
  /** Auto re-attempts initiated so far (1-based for display). */
  attempt: number
  max: number
}

/**
 * Reliable WebRTC DataChannel hook. Socket.IO carries SDP/ICE only —
 * file bytes never touch the socket. The channel is `{ ordered: true }`.
 * `active` must be true only while both peers share the room (pairing connected).
 *
 * When an established (or handshaking) connection drops while `active`,
 * reconnection is attempted automatically with backoff (up to
 * MAX_AUTO_RETRIES); afterwards the caller can still retry manually.
 */
export function useWebRTC({
  getSocket,
  roomId,
  role,
  active,
  onMessage,
}: {
  getSocket: () => Socket | null
  roomId: string | null
  role: WebRTCRole
  active: boolean
  /** DataChannel message handler (file-transfer frames). Stored in a ref. */
  onMessage: ((event: MessageEvent) => void) | null
}) {
  const [rtcStatus, setRtcStatus] = useState<RtcStatus>('idle')
  const [rtcError, setRtcError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [autoRetry, setAutoRetry] = useState<AutoRetryState>({ active: false, attempt: 0, max: MAX_AUTO_RETRIES })
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const autoTimerRef = useRef<number | null>(null)
  const autoCountRef = useRef(0)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const retry = useCallback(() => {
    const socket = getSocket()
    // A retrying receiver waits for a fresh offer — nudge the sender to re-offer.
    if (role === 'receiver' && roomId && socket?.connected) {
      socket.emit('signal', { roomId, type: 'restart-request', payload: {} })
    }
    // Manual retry starts a fresh cycle: clear any scheduled auto attempt.
    if (autoTimerRef.current !== null) {
      window.clearTimeout(autoTimerRef.current)
      autoTimerRef.current = null
    }
    autoCountRef.current = 0
    setAutoRetry({ active: false, attempt: 0, max: MAX_AUTO_RETRIES })
    setAttempt((a) => a + 1)
  }, [getSocket, role, roomId])

  const getChannel = useCallback((): RTCDataChannel | null => channelRef.current, [])

  useEffect(() => {
    if (!active || !roomId || !role) {
      setRtcStatus('idle')
      setRtcError(null)
      return
    }

    const socket = getSocket()
    if (!socket) {
      setRtcStatus('failed')
      setRtcError('Signaling socket is not available.')
      return
    }

    let disposed = false
    const pendingIce: RTCIceCandidateInit[] = []
    const pc = new RTCPeerConnection(RTC_CONFIG)
    pcRef.current = pc

    const fail = (message: string) => {
      if (disposed) return
      setRtcError(message)
      setRtcStatus('failed')
      scheduleReconnect()
    }

    /**
     * Attempt reconnection automatically with backoff while the session is
     * still active. Stops after MAX_AUTO_RETRIES — the UI then offers a
     * manual retry which starts a fresh auto cycle.
     */
    const scheduleReconnect = () => {
      if (disposed) return
      if (autoTimerRef.current !== null) return
      if (autoCountRef.current >= MAX_AUTO_RETRIES) {
        setAutoRetry({ active: false, attempt: autoCountRef.current, max: MAX_AUTO_RETRIES })
        return
      }
      const waitMs = autoRetryDelayMs(autoCountRef.current)
      setAutoRetry({ active: true, attempt: autoCountRef.current + 1, max: MAX_AUTO_RETRIES })
      autoTimerRef.current = window.setTimeout(() => {
        autoTimerRef.current = null
        if (disposed) return
        autoCountRef.current += 1
        // Mirror manual retry: a re-handshaking receiver nudges the sender.
        const sock = getSocket()
        if (role === 'receiver' && roomId && sock?.connected) {
          sock.emit('signal', { roomId, type: 'restart-request', payload: {} })
        }
        setAttempt((a) => a + 1)
      }, waitMs)
    }

    const noteOpen = () => {
      if (autoTimerRef.current !== null) {
        window.clearTimeout(autoTimerRef.current)
        autoTimerRef.current = null
      }
      autoCountRef.current = 0
      setAutoRetry({ active: false, attempt: 0, max: MAX_AUTO_RETRIES })
    }

    const flushIce = async () => {
      while (pendingIce.length > 0) {
        const candidate = pendingIce.shift()
        if (!candidate) break
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate))
        } catch {
          // Stale candidate from a superseded handshake — safe to drop.
        }
      }
    }

    const wireChannel = (channel: RTCDataChannel) => {
      channelRef.current = channel
      channel.binaryType = 'arraybuffer'
      channel.onmessage = (event) => onMessageRef.current?.(event)
      channel.onopen = () => {
        if (disposed) return
        window.clearTimeout(watchdog)
        noteOpen()
        setRtcError(null)
        setRtcStatus('open')
      }
      channel.onclose = () => {
        if (disposed) return
        // Any channel close mid-session (before or after open) is an
        // interruption worth recovering from — not just post-open drops.
        setRtcStatus('closed')
        scheduleReconnect()
      }
    }

    const watchdog = window.setTimeout(() => {
      if (disposed) return
      if (channelRef.current?.readyState !== 'open') {
        fail('Timed out establishing a direct connection. Check both devices are on the same network and retry.')
      }
    }, OPEN_TIMEOUT_MS)

    const onSignal = async (message: SignalMessage) => {
      if (disposed || !message) return
      try {
        if (message.type === 'offer' && role === 'receiver') {
          if (pc.signalingState !== 'stable') {
            try {
              await pc.setLocalDescription({ type: 'rollback' })
            } catch {
              // Rollback unsupported — proceed with the latest offer anyway.
            }
          }
          await pc.setRemoteDescription(
            new RTCSessionDescription(message.payload as RTCSessionDescriptionInit),
          )
          await flushIce()
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          socket.emit('signal', { roomId, type: 'answer', payload: answer })
          setRtcStatus('connecting')
        } else if (message.type === 'answer' && role === 'sender') {
          // Ignore stale answers from a superseded handshake.
          if (pc.signalingState !== 'have-local-offer') return
          await pc.setRemoteDescription(
            new RTCSessionDescription(message.payload as RTCSessionDescriptionInit),
          )
          await flushIce()
        } else if (message.type === 'ice') {
          const candidate = message.payload as RTCIceCandidateInit
          if (pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate))
            } catch {
              // Late/stale candidate — safe to drop.
            }
          } else {
            pendingIce.push(candidate)
          }
        } else if (message.type === 'restart-request' && role === 'sender') {
          // Receiver asked for a fresh handshake — restart locally to re-offer.
          setAttempt((a) => a + 1)
        }
      } catch {
        fail('Could not complete the direct-connection handshake. Retry to try again.')
      }
    }

    const start = async () => {
      try {
        pc.onicecandidate = (event) => {
          if (event.candidate && socket.connected) {
            socket.emit('signal', {
              roomId,
              type: 'ice',
              payload: event.candidate.toJSON(),
            })
          }
        }
        pc.onconnectionstatechange = () => {
          if (disposed) return
          if (pc.connectionState === 'failed') {
            fail('Direct connection failed. Both devices must be reachable on the same network.')
          } else if (pc.connectionState === 'closed') {
            setRtcStatus('closed')
            scheduleReconnect()
          }
        }
        pc.ondatachannel = (event) => {
          wireChannel(event.channel)
        }
        socket.on('signal', onSignal)

        if (role === 'sender') {
          setRtcStatus('signaling')
          const channel = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true })
          wireChannel(channel)
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          socket.emit('signal', { roomId, type: 'offer', payload: offer })
          if (!disposed) setRtcStatus('connecting')
        } else {
          setRtcStatus('signaling')
        }
      } catch {
        fail('Could not start the direct connection. Retry to try again.')
      }
    }

    void start()

    return () => {
      disposed = true
      window.clearTimeout(watchdog)
      if (autoTimerRef.current !== null) {
        window.clearTimeout(autoTimerRef.current)
        autoTimerRef.current = null
      }
      socket.off('signal', onSignal)
      try {
        channelRef.current?.close()
      } catch {
        // Already closed — nothing to do.
      }
      try {
        pc.close()
      } catch {
        // Already closed — nothing to do.
      }
      channelRef.current = null
      pcRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, roomId, role, attempt])

  return { rtcStatus, rtcError, retry, getChannel, autoRetry }
}
