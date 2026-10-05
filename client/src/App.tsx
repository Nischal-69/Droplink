import { Lock, Upload } from 'lucide-react'
import Header from './components/Header'

function App() {
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

        <section
          aria-label="Send files"
          className="mt-8 w-full rounded-xl border border-border bg-white p-6 sm:p-8"
        >
          <h2 className="text-center text-lg font-semibold">Send files</h2>

          <div className="mt-5 rounded-lg border border-dashed border-border bg-background px-4 py-8 text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
              <Upload size={22} className="text-primary" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-semibold">Drop files here</p>
            <p className="mt-1 text-sm text-muted">or browse your device</p>
            <p className="mt-3 text-xs text-muted">
              Your files are transferred directly.
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled
              title="Sending coming soon"
              className="flex-1 cursor-not-allowed rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white opacity-50"
            >
              Send Files
            </button>
            <button
              type="button"
              disabled
              title="Receiving coming soon"
              className="flex-1 cursor-not-allowed rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold text-dark opacity-60"
            >
              Receive Files
            </button>
          </div>

          <p className="mt-5 flex items-start justify-center gap-1.5 text-center text-xs leading-relaxed text-muted">
            <Lock size={13} className="mt-0.5 shrink-0" aria-hidden />
            No cloud storage. No file uploads. Direct device-to-device transfer.
          </p>
        </section>
      </main>
    </div>
  )
}

export default App
