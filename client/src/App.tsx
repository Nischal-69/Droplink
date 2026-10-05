import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'

type BackendStatus = 'checking' | 'online' | 'offline'

function App() {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking')
  const [socketId, setSocketId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(() => setBackendStatus('online'))
      .catch(() => setBackendStatus('offline'))
  }, [])

  useEffect(() => {
    const socket = io({ autoConnect: true })

    socket.on('connect', () => {
      setSocketId(socket.id ?? null)
    })

    socket.on('disconnect', () => {
      setSocketId(null)
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
        <p className="rounded-full border border-sky-400/30 bg-sky-400/10 px-4 py-1 text-sm text-sky-300">
          Same Wi-Fi • Peer-to-Peer • No server storage
        </p>
        <h1 className="mt-6 text-5xl font-bold tracking-tight">
          Drop<span className="text-sky-400">Link</span>
        </h1>
        <p className="mt-4 max-w-xl text-slate-400">
          A simple peer-to-peer file transfer app for devices on the same Wi-Fi
          network. Files go directly between browsers — nothing is stored on the
          server.
        </p>

        <div className="mt-8 grid w-full gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-left">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Backend
            </h2>
            <p className="mt-2 text-lg font-medium">
              {backendStatus === 'checking' && 'Checking…'}
              {backendStatus === 'online' && '🟢 Online'}
              {backendStatus === 'offline' && '🔴 Offline'}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              GET /api/health via Vite proxy
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-left">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Socket.IO
            </h2>
            <p className="mt-2 text-lg font-medium">
              {socketId ? `🟢 Connected (${socketId.slice(0, 6)}…)` : '🔴 Disconnected'}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Signaling ready for future P2P transfer
            </p>
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-8 w-full">
          <p className="text-slate-300 font-medium">File transfer coming soon</p>
          <p className="mt-1 text-sm text-slate-500">
            Project structure and signaling setup only — no transfer logic yet.
          </p>
        </div>
      </div>
    </div>
  )
}

export default App
