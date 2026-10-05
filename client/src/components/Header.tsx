import DropLinkLogo from './DropLinkLogo'

export default function Header() {
  return (
    <header className="border-b border-border bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <DropLinkLogo size={32} />
          <span className="text-base font-bold tracking-tight text-dark">
            DropLink
          </span>
          <span className="rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
            Private P2P
          </span>
        </div>
      </div>
    </header>
  )
}
