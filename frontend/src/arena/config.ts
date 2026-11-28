/**
 * Central demo configuration for the participant competition prototype.
 *
 * Set DEMO_MODE to false (or provide a real provider) when the backend is
 * connected. Every mock record lives under ./data and is reached only through
 * the provider selected in ./services/index.ts. No UI component imports raw
 * mock records directly.
 */
export const DEMO_MODE = true

export const EVENT = {
  name: 'The Fall Back',
  organiser: 'Software Development Club',
  organiserShort: 'SDC',
  edition: 'Fall 2026',
  venue: 'Offline, VIT Bhopal University',
  date: '6 December 2026',
  durationMinutes: 180,
  teamSize: '4 to 5',
} as const

export const DEMO_BANNER = 'DEMO ENVIRONMENT - SAMPLE DATA'

export const AI_NOTICE = 'AI ASSISTANCE: DISABLED - LEVEL 4'

/** Rule sets shown in the restrictions indicator, keyed by level number. */
export const LEVEL_POLICY: Record<
  number,
  {
    aiAllowed: boolean
    copyRestricted: boolean
    pasteRestricted: boolean
    devToolsRestricted: boolean
    label: string
    summary: string
  }
> = {
  1: {
    aiAllowed: false,
    copyRestricted: true,
    pasteRestricted: true,
    devToolsRestricted: true,
    label: 'Investigation mode',
    summary: 'Copy, paste and browser developer tools are restricted by event policy.',
  },
  2: {
    aiAllowed: false,
    copyRestricted: true,
    pasteRestricted: true,
    devToolsRestricted: true,
    label: 'Investigation mode',
    summary: 'Copy, paste and browser developer tools are restricted by event policy.',
  },
  3: {
    aiAllowed: true,
    copyRestricted: false,
    pasteRestricted: false,
    devToolsRestricted: false,
    label: 'Repair mode',
    summary: 'AI assistance is enabled. Clipboard and tooling follow the configured policy.',
  },
  4: {
    aiAllowed: false,
    copyRestricted: true,
    pasteRestricted: true,
    devToolsRestricted: true,
    label: 'Restricted final mode',
    summary: 'AI assistance is disabled. Copy, paste and developer tools are restricted.',
  },
}
