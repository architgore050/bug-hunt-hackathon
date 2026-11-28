import type { ReactNode } from 'react'

export type IconName =
  | 'overview' | 'level' | 'questions' | 'repo' | 'workspace' | 'flag' | 'team'
  | 'leaderboard' | 'bell' | 'user' | 'chevron-down' | 'chevron-right' | 'lock'
  | 'check' | 'close' | 'search' | 'clock' | 'shield' | 'chat' | 'terminal'
  | 'file' | 'folder' | 'arrow-up' | 'arrow-down' | 'dash' | 'warning'
  | 'sliders' | 'play' | 'refresh' | 'plus' | 'send' | 'code' | 'branch'
  | 'menu' | 'panel' | 'bolt' | 'target' | 'inbox'

const paths: Record<IconName, ReactNode> = {
  overview: <><rect x="2.5" y="2.5" width="5" height="5" rx=".5" /><rect x="9.5" y="2.5" width="4" height="5" rx=".5" /><rect x="2.5" y="9.5" width="4" height="4" rx=".5" /><rect x="9.5" y="9.5" width="4" height="4" rx=".5" /></>,
  level: <><path d="M2 5.5 8 2.5l6 3-6 3-6-3Z" /><path d="m2 10 6 3 6-3" /><path d="m2 13.5 6 3 6-3" /></>,
  questions: <><path d="M4 3.5h8M4 7.5h8M4 11.5h5" /><circle cx="12.5" cy="12" r="2.5" /></>,
  repo: <><path d="M2.5 5.5V3.5h4l1.5 2h5.5v9.5H2.5Z" /><path d="M2.5 8.5h11" /></>,
  workspace: <><path d="m5.5 5-3 3 3 3M10.5 5l3 3-3 3" /><path d="m9 2.5-2 11" /></>,
  flag: <><path d="M4 14V3M4 3.5h8l-1.5 3L12 9.5H4" /></>,
  team: <><circle cx="6" cy="6" r="2.2" /><circle cx="11.5" cy="6.5" r="1.7" /><path d="M2.5 13c.3-2.3 1.7-3.5 3.5-3.5s3.2 1.2 3.5 3.5M10 10c2 .1 3.3 1.2 3.5 3" /></>,
  leaderboard: <><path d="M3 14V8M7.5 14V4M12 14v-4" /><path d="M2 14.5h12" /></>,
  bell: <><path d="M4 11c0-2.5.8-6 4-6s4 3.5 4 6l1 2H3l1-2Z" /><path d="M6.5 14.5h3" /></>,
  user: <><circle cx="8" cy="5.5" r="2.6" /><path d="M3 14c.4-2.8 2.2-4.1 5-4.1s4.6 1.3 5 4.1" /></>,
  'chevron-down': <path d="m4 6 4 4 4-4" />,
  'chevron-right': <path d="m6 4 4 4-4 4" />,
  lock: <><rect x="3.5" y="7" width="9" height="6.5" rx=".6" /><path d="M5.5 7V5.3a2.5 2.5 0 0 1 5 0V7" /></>,
  check: <path d="m3 8.5 3.2 3L13 4.5" />,
  close: <><path d="m4 4 8 8M12 4l-8 8" /></>,
  search: <><circle cx="7" cy="7" r="4" /><path d="m10 10 3.5 3.5" /></>,
  clock: <><circle cx="8" cy="8" r="5.5" /><path d="M8 4.8V8l2.2 1.5" /></>,
  shield: <><path d="M8 2.5 13 4v4c0 3-2 5.2-5 6-3-.8-5-3-5-6V4l5-1.5Z" /><path d="m5.8 8 1.5 1.5 3-3" /></>,
  chat: <><path d="M3 4.5h10v7H7l-3 2.5v-2.5H3Z" /><path d="M5.5 8h5" /></>,
  terminal: <><rect x="2.5" y="3" width="11" height="10" rx=".7" /><path d="m5 6.5 2 1.7-2 1.7M8.5 10h2.5" /></>,
  file: <><path d="M4 2.5h5l3 3v8H4Z" /><path d="M9 2.5v3h3" /></>,
  folder: <><path d="M2.5 5.5V3.5h4l1.5 2h5.5v9.5H2.5Z" /></>,
  'arrow-up': <path d="M8 13V4M4.5 7.5 8 4l3.5 3.5" />,
  'arrow-down': <path d="M8 3v9M4.5 8.5 8 12l3.5-3.5" />,
  dash: <path d="M4 8h8" />,
  warning: <><path d="M8 2.8 14 13H2L8 2.8Z" /><path d="M8 6.5v3.2M8 11.3v.2" /></>,
  sliders: <><path d="M3 4.5h10M3 8h10M3 11.5h10" /><circle cx="6" cy="4.5" r="1.2" /><circle cx="10.5" cy="8" r="1.2" /><circle cx="5" cy="11.5" r="1.2" /></>,
  play: <path d="M5 3.5v9l7-4.5-7-4.5Z" />,
  refresh: <><path d="M13 6.5A5.2 5.2 0 0 0 3.5 8" /><path d="M3 9.5A5.2 5.2 0 0 0 12.5 8" /><path d="M13 3.5v3h-3M3 12.5v-3h3" /></>,
  plus: <path d="M8 3v10M3 8h10" />,
  send: <><path d="M13.5 2.5 2.5 7l4.5 1.8L8.8 13l4.7-10.5Z" /><path d="m7 8.8 3-3" /></>,
  code: <><path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5 14 8l-3.5 3.5" /></>,
  branch: <><circle cx="5" cy="4" r="1.5" /><circle cx="5" cy="12" r="1.5" /><circle cx="11.5" cy="6" r="1.5" /><path d="M5 5.5v5M6.5 4h2.2a2 2 0 0 1 2 2v0" /></>,
  menu: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
  panel: <><rect x="2.5" y="3" width="11" height="10" rx=".7" /><path d="M10 3v10" /></>,
  bolt: <path d="M9 2 4 9h3.5L6.5 14 12 7H8.5L9 2Z" />,
  target: <><circle cx="8" cy="8" r="5" /><circle cx="8" cy="8" r="1.8" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" /></>,
  inbox: <><path d="M2.5 8.5 4 3.5h8l1.5 5v4H2.5Z" /><path d="M2.5 8.5h3l1 1.5h3l1-1.5h3" /></>,
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  )
}
