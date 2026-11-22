// Bespoke inline SVG stroke icons for the Bug Hunt CTF console.
// Drawn for this project: 1.5px square-cap strokes on a 24px grid.
// No icon library, no emoji, no sparkle shapes.

import type { CSSProperties, ReactNode } from 'react'

interface IconProps {
  size?: number
  strokeWidth?: number
  className?: string
  style?: CSSProperties
}

function base(props: IconProps): { size: number; strokeWidth: number; className: string | undefined; style: CSSProperties | undefined } {
  return {
    size: props.size ?? 16,
    strokeWidth: props.strokeWidth ?? 1.5,
    className: props.className,
    style: props.style,
  }
}

function svg(path: ReactNode, props: IconProps, viewBox = '0 0 24 24') {
  const { size, strokeWidth, className, style } = base(props)
  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className ? `icon ${className}` : 'icon'}
      style={style}
    >
      {path}
    </svg>
  )
}

export function MagnifierIcon(props: IconProps) {
  return svg(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <line x1="15.8" y1="15.8" x2="21" y2="21" />
    </>,
    props,
  )
}

export function FileIcon(props: IconProps) {
  return svg(
    <>
      <path d="M6 3h8l4 4.5V21H6z" />
      <path d="M14 3v4.5h4" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="15.5" x2="15" y2="15.5" />
    </>,
    props,
  )
}

export function FlagIcon(props: IconProps) {
  return svg(
    <>
      <line x1="5" y1="3.5" x2="5" y2="21" />
      <path d="M5 4.5h13.5l-3.2 4 3.2 4H5" />
    </>,
    props,
  )
}

export function ClockIcon(props: IconProps) {
  return svg(
    <>
      <circle cx="12" cy="12.5" r="8" />
      <path d="M12 8v5l3.5 2" />
      <line x1="9" y1="2.5" x2="15" y2="2.5" />
    </>,
    props,
  )
}

export function ShieldIcon(props: IconProps) {
  return svg(
    <>
      <path d="M12 2.5l7.5 3v5.5c0 5.5-3.4 9.3-7.5 10.9C7.9 20.3 4.5 16.5 4.5 11V5.5z" />
      <path d="M8.8 11.5l2.4 2.4 4-4.5" />
    </>,
    props,
  )
}

export function TerminalCaretIcon(props: IconProps) {
  return svg(
    <>
      <rect x="2.5" y="4" width="19" height="16" />
      <path d="M7 9.5l3 2.5-3 2.5" />
      <line x1="12.5" y1="14.5" x2="17" y2="14.5" />
    </>,
    props,
  )
}

export function FolderIcon(props: IconProps) {
  return svg(
    <>
      <path d="M3 6.5h6.5l2 2.5H21v11.5H3z" />
      <path d="M3 6.5V20.5" />
    </>,
    props,
  )
}

export function SubmitArrowIcon(props: IconProps) {
  return svg(
    <>
      <line x1="3.5" y1="12" x2="17" y2="12" />
      <path d="M12.5 6.5l5.5 5.5-5.5 5.5" />
      <line x1="3.5" y1="18.5" x2="8" y2="18.5" />
    </>,
    props,
  )
}

export function AlertTriangleIcon(props: IconProps) {
  return svg(
    <>
      <path d="M12 3.5L2.5 20h19z" />
      <line x1="12" y1="9" x2="12" y2="14.5" />
      <line x1="12" y1="17" x2="12" y2="17.01" />
    </>,
    props,
  )
}

export function CheckIcon(props: IconProps) {
  return svg(<path d="M4.5 12.5l5 5L19.5 7" />, props)
}

export function CrossIcon(props: IconProps) {
  return svg(
    <>
      <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" />
      <line x1="18.5" y1="5.5" x2="5.5" y2="18.5" />
    </>,
    props,
  )
}

export function UserIcon(props: IconProps) {
  return svg(
    <>
      <circle cx="12" cy="7.5" r="3.75" />
      <path d="M4.5 20.5c1.6-3.8 4.3-5.5 7.5-5.5s5.9 1.7 7.5 5.5" />
    </>,
    props,
  )
}

export function TeamIcon(props: IconProps) {
  return svg(
    <>
      <circle cx="8.5" cy="8.5" r="3.25" />
      <path d="M2.5 19.5c1.4-3.2 3.6-4.6 6-4.6s4.6 1.4 6 4.6" />
      <circle cx="16.75" cy="9.75" r="2.5" />
      <path d="M16.5 14.9c2.3 0 4.1 1.2 5 3.6" />
    </>,
    props,
  )
}

export function SettingsIcon(props: IconProps) {
  return svg(
    <>
      <circle cx="12" cy="12" r="3.25" />
      <line x1="12" y1="2.5" x2="12" y2="5.5" />
      <line x1="12" y1="18.5" x2="12" y2="21.5" />
      <line x1="2.5" y1="12" x2="5.5" y2="12" />
      <line x1="18.5" y1="12" x2="21.5" y2="12" />
      <line x1="5.3" y1="5.3" x2="7.4" y2="7.4" />
      <line x1="16.6" y1="16.6" x2="18.7" y2="18.7" />
      <line x1="18.7" y1="5.3" x2="16.6" y2="7.4" />
      <line x1="7.4" y1="16.6" x2="5.3" y2="18.7" />
    </>,
    props,
  )
}

export function ExportIcon(props: IconProps) {
  return svg(
    <>
      <path d="M12 15V4" />
      <path d="M8 7.5L12 3.5l4 4" />
      <path d="M4.5 12.5v8h15v-8" />
    </>,
    props,
  )
}

export function LinkIcon(props: IconProps) {
  return svg(
    <>
      <path d="M10.2 13.8l3.6-3.6" />
      <path d="M8.8 7.2l2-2a3.8 3.8 0 015.4 5.4l-2 2" />
      <path d="M15.2 16.8l-2 2a3.8 3.8 0 01-5.4-5.4l2-2" />
    </>,
    props,
  )
}

export function ReceiptIcon(props: IconProps) {
  return svg(
    <>
      <path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </>,
    props,
  )
}
