import type { CSSProperties, ReactNode } from 'react'

interface IconProps {
  size?: number
  strokeWidth?: number
  className?: string
  style?: CSSProperties
}

function svg(path: ReactNode, props: IconProps) {
  const size = props.size ?? 18
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={props.strokeWidth ?? 1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={props.className ? `icon ${props.className}` : 'icon'}
      style={props.style}
    >
      {path}
    </svg>
  )
}

export function GridIcon(props: IconProps) {
  return svg(<><rect x="3.5" y="3.5" width="7" height="7" /><rect x="13.5" y="3.5" width="7" height="7" /><rect x="3.5" y="13.5" width="7" height="7" /><rect x="13.5" y="13.5" width="7" height="7" /></>, props)
}

export function UsersIcon(props: IconProps) {
  return svg(<><circle cx="9" cy="8" r="3.25" /><path d="M3 19c1.4-3.4 3.6-5 6-5s4.6 1.6 6 5" /><circle cx="17.5" cy="9" r="2.5" /><path d="M16 14.4c2.2.3 3.9 1.8 5 4.6" /></>, props)
}

export function ClipboardCheckIcon(props: IconProps) {
  return svg(<><rect x="5" y="4.5" width="14" height="16.5" /><path d="M9 4.5V3h6v1.5" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></>, props)
}

export function TrophyIcon(props: IconProps) {
  return svg(<><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 5.5H4v1.5a3 3 0 0 0 3 3" /><path d="M17 5.5h3v1.5a3 3 0 0 1-3 3" /><path d="M12 14v3" /><path d="M8.5 20h7" /><path d="M10 17h4l.5 3h-5z" /></>, props)
}

export function IncidentIcon(props: IconProps) {
  return svg(<><path d="M12 3.5L2.5 20h19z" /><line x1="12" y1="9.5" x2="12" y2="14.5" /><line x1="12" y1="17" x2="12" y2="17.01" /></>, props)
}

export function ServerIcon(props: IconProps) {
  return svg(<><rect x="3.5" y="4" width="17" height="7" /><rect x="3.5" y="13" width="17" height="7" /><line x1="7" y1="7.5" x2="7.01" y2="7.5" /><line x1="7" y1="16.5" x2="7.01" y2="16.5" /></>, props)
}

export function SlidersIcon(props: IconProps) {
  return svg(<><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="17" x2="20" y2="17" /><circle cx="9" cy="7" r="2.5" /><circle cx="15" cy="17" r="2.5" /></>, props)
}

export function KeyIcon(props: IconProps) {
  return svg(<><circle cx="8" cy="12" r="3.5" /><line x1="11.5" y1="12" x2="21" y2="12" /><line x1="18" y1="12" x2="18" y2="15.5" /><line x1="15" y1="12" x2="15" y2="14.5" /></>, props)
}

export function BellIcon(props: IconProps) {
  return svg(<><path d="M6 9a6 6 0 0 1 12 0c0 5 1.5 6.5 2 7H4c.5-.5 2-2 2-7z" /><path d="M9.5 20a2.5 2.5 0 0 0 5 0" /></>, props)
}

export function MenuIcon(props: IconProps) {
  return svg(<><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></>, props)
}

export function LogoutIcon(props: IconProps) {
  return svg(<><path d="M9 4.5H5v15h4" /><path d="M12.5 12H20" /><path d="M16.5 8l4 4-4 4" /></>, props)
}

export function PlusIcon(props: IconProps) {
  return svg(<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>, props)
}

export function SearchIcon(props: IconProps) {
  return svg(<><circle cx="11" cy="11" r="6.5" /><line x1="15.8" y1="15.8" x2="21" y2="21" /></>, props)
}

export function UploadIcon(props: IconProps) {
  return svg(<><path d="M12 15V4" /><path d="M8 8l4-4 4 4" /><path d="M4.5 14.5v5h15v-5" /></>, props)
}

export function ChevronIcon(props: IconProps) {
  return svg(<path d="M6 9l6 6 6-6" />, props)
}
