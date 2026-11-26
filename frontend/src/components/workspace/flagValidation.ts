// Pure validation and parsing helpers for the structured flag panel
// (levels 1 and 2). Mirrors backend/app/routers/levels.py `_validate_flag`
// so a flag that passes here is accepted by POST /v1/levels/:n/submit:
//   - title: strip-trimmed 5..120 characters (raw length capped at 120)
//   - category: one of CATEGORIES
//   - description: strip-trimmed >= 20, raw <= 2000
//   - evidence: optional, raw <= 2000
//   - claimed_severity: optional, one of SEVERITIES
//   - locations: level 1 exactly one, level 2 one to limits.maxLocations;
//     each file_path must exist verbatim, lines 1..100000, end >= start,
//     span <= limits.maxSpan, end <= max(line_count, 1) + EOF tolerance.

import { CATEGORIES, SEVERITIES } from '../../lib/types'
import type { ChallengeFile, Severity } from '../../lib/types'
import type { FlagDraft } from '../../lib/api-levels'

export interface FlagLimits {
  maxFlags: number
  maxSpan: number
  maxLocations: number
}

/** Backend cfg `location_tolerance_lines` default: a range may end this many lines past EOF. */
export const LOCATION_EOF_TOLERANCE = 2

const MAX_LINE_NO = 100000

/** Funny description placeholders shown while the description is empty. Never sent to the server. */
export const DESCRIPTION_PLACEHOLDERS: string[] = [
  'This line has been acting suspicious since the last commit.',
  'Found it. It was hiding behind a semicolon.',
  'Gut feeling. Mostly caffeine.',
  "I'd bet my lunch this line is guilty.",
  'This line looked at me funny.',
  'It compiles. That is all it does.',
  'The rubber duck raised an eyebrow at this line.',
  'Unit tests walked right past this one.',
]

/** One random pool line, chosen once per flag at creation and then kept in panel state. */
export function randomPlaceholder(): string {
  const idx = Math.floor(Math.random() * DESCRIPTION_PLACEHOLDERS.length)
  const line = DESCRIPTION_PLACEHOLDERS[idx]
  return line ?? DESCRIPTION_PLACEHOLDERS[0]
}

/**
 * Parses a lines field value: "12" or "12-18" (whitespace tolerated).
 * Returns null when the text is empty or not a clean number or range.
 * A reversed range like "18-12" is returned as typed so validation can
 * flag it, matching the backend "start after end" rejection.
 */
export function parseLines(text: string): { start: number; end: number } | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const single = /^(\d+)$/.exec(trimmed)
  if (single) {
    return { start: Number(single[1]), end: Number(single[1]) }
  }
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed)
  if (range) {
    return { start: Number(range[1]), end: Number(range[2]) }
  }
  return null
}

/** Inverse of parseLines for rendering a stored location back into the input. */
export function fmtLines(loc: { line_start: number; line_end: number }): string {
  if (loc.line_start < 1) return ''
  if (loc.line_start === loc.line_end) return String(loc.line_start)
  return `${loc.line_start}-${loc.line_end}`
}

function isCleanLineNo(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_LINE_NO
}

/**
 * Field errors for one flag against the server contract. Empty object = valid.
 * Keys: title, category, description, evidence, claimed_severity,
 * locations (count problems), and per-row locations[i].file_path / locations[i].lines.
 */
export function validateFlag(
  flag: FlagDraft,
  levelNo: 1 | 2,
  files: ChallengeFile[],
  limits: FlagLimits,
): Record<string, string> {
  const errors: Record<string, string> = {}

  const title = flag.title.trim()
  if (title.length < 5 || flag.title.length > 120) {
    errors.title = 'Required: 5 to 120 characters.'
  }

  if (!(CATEGORIES as readonly string[]).includes(flag.category)) {
    errors.category = 'Category must come from the taxonomy.'
  }

  if (flag.description.trim().length < 20) {
    errors.description = 'Required: at least 20 characters explaining the defect.'
  } else if (flag.description.length > 2000) {
    errors.description = 'Description must stay at or under 2000 characters.'
  }

  if (flag.evidence !== null && flag.evidence.length > 2000) {
    errors.evidence = 'Evidence must stay at or under 2000 characters.'
  }

  if (flag.claimed_severity !== null && !(SEVERITIES as Severity[]).includes(flag.claimed_severity)) {
    errors.claimed_severity = 'Severity must be low, medium, high or critical.'
  }

  if (levelNo === 1 && flag.locations.length !== 1) {
    errors.locations = 'Level 1 flags carry exactly one location.'
  }
  if (levelNo === 2 && !(flag.locations.length >= 1 && flag.locations.length <= limits.maxLocations)) {
    errors.locations = `Level 2 flags carry 1 to ${limits.maxLocations} ordered locations.`
  }

  flag.locations.forEach((loc, i) => {
    const file = files.find((f) => f.path === loc.file_path)
    if (file === undefined) {
      errors[`locations[${i}].file_path`] = 'File path must match a challenge file exactly.'
    }
    if (!(isCleanLineNo(loc.line_start) && isCleanLineNo(loc.line_end))) {
      errors[`locations[${i}].lines`] = 'Use a line number like 12 or a range like 12-18.'
    } else if (loc.line_end < loc.line_start) {
      errors[`locations[${i}].lines`] = 'Range start must not come after the end.'
    } else if (loc.line_end - loc.line_start + 1 > limits.maxSpan) {
      errors[`locations[${i}].lines`] = `Span exceeds ${limits.maxSpan} lines. Narrow the range to the defect.`
    } else if (file !== undefined && loc.line_end > Math.max(file.line_count, 1) + LOCATION_EOF_TOLERANCE) {
      errors[`locations[${i}].lines`] =
        `Range reaches past the end of the file (${file.line_count} lines on record, ${LOCATION_EOF_TOLERANCE} line tolerance).`
    }
  })

  return errors
}

/** "n of m flags ready", counting flags with no validation errors. */
export function flagIssuesSummary(
  flags: FlagDraft[],
  levelNo: 1 | 2,
  files: ChallengeFile[],
  limits: FlagLimits,
): string {
  let ready = 0
  for (const flag of flags) {
    if (Object.keys(validateFlag(flag, levelNo, files, limits)).length === 0) ready += 1
  }
  return `${ready} of ${flags.length} flags ready`
}
