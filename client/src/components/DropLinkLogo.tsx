type Props = {
  size?: number
  className?: string
}

/**
 * DropLink logo — rounded square in Primary (#2563EB)
 * with a white peer-to-peer link mark. No gradients.
 */
export default function DropLinkLogo({ size = 36, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      role="img"
      aria-label="DropLink logo"
      className={className}
    >
      <rect width="36" height="36" rx="9" fill="#2563EB" />
      <path
        d="M15.2 20.8a4.2 4.2 0 0 0 5.9 0l2.9-2.9a4.2 4.2 0 0 0-5.9-5.9l-1.5 1.5"
        stroke="#FFFFFF"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20.8 15.2a4.2 4.2 0 0 0-5.9 0l-2.9 2.9a4.2 4.2 0 0 0 5.9 5.9l1.5-1.5"
        stroke="#FFFFFF"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
