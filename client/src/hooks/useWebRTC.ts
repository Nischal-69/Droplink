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

/**
 * Reliable WebRTC DataChannel hook. Socket.IO carries SDP/ICE only —
 * file bytes never touch the socket. The channel is `{ ordered: true }`.
 * `active` must be true only while both peers share the room (pairing connected).
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
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const retry = useCallback(() => {
    const socket = getSocket()
    // A retrying receiver waits for a fresh offer — nudge the sender to re-offer.
    if (role === 'receiver' && roomId && socket?.connected) {
      socket.emit('signal', { roomId, type: 'restart-request', payload: {} })
    }
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
        setRtcError(null)
        setRtcStatus('open')
      }
      channel.onclose = () => {
        if (disposed) return
        setRtcStatus((prev) => (prev === 'open' ? 'closed' : prev))
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

  return { rtcStatus, rtcError, retry, getChannel }
}
