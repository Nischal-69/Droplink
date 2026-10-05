export default function Footer() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-center sm:flex-row sm:px-6 sm:text-left">
        <p className="text-xs text-muted">
          <span className="font-semibold text-dark">DropLink</span> • Same-network P2P sharing
        </p>
        <p className="text-xs text-muted">UI preview — transfer functionality not implemented yet.</p>
      </div>
    </footer>
  )
}
