import { Files, ShieldCheck, Wifi } from 'lucide-react'

const STEPS = [
  {
    icon: Wifi,
    title: '1. Join the same Wi-Fi',
    text: 'Open DropLink on both devices connected to the same network.',
  },
  {
    icon: Files,
    title: '2. Pick files',
    text: 'Select files on the sender. They stay on your device until sent.',
  },
  {
    icon: ShieldCheck,
    title: '3. Send peer-to-peer',
    text: 'Files travel directly between browsers. No server storage.',
  },
]

export default function HowItWorks() {
  return (
    <section aria-label="How it works" className="rounded-xl border border-border bg-white p-5 sm:p-6">
      <h2 className="text-base font-semibold text-dark">How it works</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.title} className="rounded-lg border border-border bg-background p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <step.icon size={18} className="text-primary" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-semibold text-dark">{step.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{step.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
