type Props = {
  value: number
  tall?: boolean
}

/** Single byte-driven progress bar — tall for the live panel, slim for queue rows. */
export default function ProgressBar({ value, tall }: Props) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={`w-full overflow-hidden rounded-full bg-background ring-1 ring-border ${tall ? 'h-3 sm:h-2.5' : 'h-1.5'}`}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
    </div>
  )
}
