import { useState } from 'react'
import Header from './components/Header'
import ReceiveFilesCard from './components/ReceiveFilesCard'
import SendFilesCard from './components/SendFilesCard'

function App() {
  const [mode, setMode] = useState<'send' | 'receive'>('send')

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
          <SendFilesCard onSwitchToReceive={() => setMode('receive')} />
        ) : (
          <ReceiveFilesCard onSwitchToSend={() => setMode('send')} />
        )}
      </main>
    </div>
  )
}

export default App
