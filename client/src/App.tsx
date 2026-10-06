import { useState } from 'react'
import Header from './components/Header'
import ReceiveFilesCard from './components/ReceiveFilesCard'
import SendFilesCard from './components/SendFilesCard'
import { parsePairingLink } from './utils/pairingLink'

function getInitialPairing(): { mode: 'send' | 'receive'; code: string } {
  if (typeof window === 'undefined') return { mode: 'send', code: '' }
  const { mode, code } = parsePairingLink(window.location.search)
  return { mode: mode ?? 'send', code }
}

/** Sync the address bar so a scanned QR link re-opens the right page. */
function syncModeToUrl(mode: 'send' | 'receive') {
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('mode', mode)
    if (mode === 'send') url.searchParams.delete('code')
    window.history.replaceState(null, '', url)
  } catch {
    // Address-bar sync is best-effort — pairing works without it.
  }
}

function App() {
  const [initial] = useState(getInitialPairing)
  const [mode, setMode] = useState<'send' | 'receive'>(initial.mode)

  const switchMode = (next: 'send' | 'receive') => {
    setMode(next)
    syncModeToUrl(next)
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-dark">
      <Header />

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-4 py-10 sm:px-6 sm:py-14">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Transfer files directly.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
            Fast file sharing between devices on the same network.
          </p>
        </div>

        {mode === 'send' ? (
          <SendFilesCard onSwitchToReceive={() => switchMode('receive')} />
        ) : (
          <ReceiveFilesCard
            initialCode={initial.code}
            onSwitchToSend={() => switchMode('send')}
          />
        )}
      </main>
    </div>
  )
}

export default App
