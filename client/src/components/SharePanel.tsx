import { useState } from 'react'
import { Check, Copy, FileText, Laptop, Link2, Upload } from 'lucide-react'

const ROOM_CODE = 'drop-4f8k2'
const DEVICE_NAME = 'My Laptop'

export default function SharePanel() {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ROOM_CODE)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section aria-label="Your device and room" className="rounded-xl border border-border bg-white">
      <div className="border-b border-border p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Laptop size={20} className="text-primary" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold text-dark">Your device</h2>
              <p className="text-sm text-muted">{DEVICE_NAME} • Visible on this Wi-Fi</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            Preview
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Link2 size={16} className="shrink-0 text-muted" aria-hidden />
            <span className="text-muted">Room code</span>
            <span className="font-mono text-sm font-semibold text-dark">{ROOM_CODE}</span>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-dark hover:border-primary hover:text-primary"
          >
            {copied ? (
              <>
                <Check size={14} aria-hidden /> Copied
              </>
            ) : (
              <>
                <Copy size={14} aria-hidden /> Copy
              </>
            )}
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <h3 className="text-sm font-semibold text-dark">Share files</h3>
        <p className="mt-1 text-sm text-muted">
          Files are sent directly between browsers. Nothing is uploaded or stored.
        </p>

        <div className="mt-4 rounded-lg border border-dashed border-border bg-background p-6 text-center sm:p-8">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
            <Upload size={22} className="text-primary" aria-hidden />
          </span>
          <p className="mt-3 text-sm font-semibold text-dark">Drag files here</p>
          <p className="mt-1 text-xs text-muted">or browse from your device</p>
          <button
            type="button"
            disabled
            title="File picker coming soon"
            className="mt-4 inline-flex cursor-not-allowed items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white opacity-50"
          >
            Select files
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-border p-4">
          <p className="text-sm font-semibold text-dark">Selected files</p>
          <div className="mt-2 flex items-center gap-3 rounded-lg bg-background px-3 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-border">
              <FileText size={18} className="text-muted" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-dark">No files selected yet</p>
              <p className="text-xs text-muted">Choose a nearby device to start sending</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
