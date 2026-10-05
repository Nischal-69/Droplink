import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { io } from 'socket.io-client'
import DevicesPanel from './components/DevicesPanel'
import Footer from './components/Footer'
import Header from './components/Header'
import HowItWorks from './components/HowItWorks'
import SharePanel from './components/SharePanel'

function App() {
  const [backendOnline, setBackendOnline] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)
  const [socketId, setSocketId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        setBackendOnline(res.ok)
      })
      .catch(() => setBackendOnline(false))
  }, [])

  useEffect(() => {
    const socket = io({ autoConnect: true })

    socket.on('connect', () => {
      setSocketConnected(true)
      setSocketId(socket.id ?? null)
    })

    socket.on('disconnect', () => {
      setSocketConnected(false)
      setSocketId(null)
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  return (
    <div className="min-h-screen bg-background text-dark">
      <Header backendOnline={backendOnline} socketConnected={socketConnected} />

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Send files to nearby devices
          </h1>
          <p className="mt-2 flex items-start gap-1.5 text-sm leading-relaxed text-muted">
            <Lock size={15} className="mt-0.5 shrink-0" aria-hidden />
            Direct browser-to-browser transfer over your Wi-Fi. The server only
            helps devices find each other.
          </p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <SharePanel />
          </div>
          <div className="lg:col-span-2">
            <DevicesPanel
              backendOnline={backendOnline}
              socketConnected={socketConnected}
              socketId={socketId}
            />
          </div>
        </div>

        <div className="mt-6">
          <HowItWorks />
        </div>
      </main>

      <Footer />
    </div>
  )
}

export default App
