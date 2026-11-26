// Structured flag panel for levels 1 and 2: a list of FlagDraft entries with
// per-flag validation against the submit contract (see ./flagValidation.ts),
// autofill of file and lines from the workspace code viewer, ordered location
// rows on level 2, and a gated submit area with an explicit empty submission
// confirmation. The panel is fully controlled: edits flow through
// onFlagsChange and submissions through onSubmit.

import { useState } from 'react'
import { ApiRequestError } from '../../lib/api'
import type { FlagDraft, FlagLocation } from '../../lib/api-levels'
import { CATEGORIES, SEVERITIES } from '../../lib/types'
import type { ChallengeFile, Severity } from '../../lib/types'
import { Button, Chip, ConfirmButton, EmptyState, Field, Panel } from '../../ui/components'
import { FlagIcon, SubmitArrowIcon } from '../../ui/icons'
import {
  DESCRIPTION_PLACEHOLDERS,
  flagIssuesSummary,
  fmtLines,
  parseLines,
  randomPlaceholder,
  validateFlag,
} from './flagValidation'
import type { FlagLimits } from './flagValidation'
import './flagpanel.css'

export interface FlagSelection {
  path: string
  start: number
  end: number
}

export interface FlagPanelProps {
  levelNo: 1 | 2
  files: ChallengeFile[]
  activePath: string | null
  selection: FlagSelection | null
  limits: FlagLimits
  flags: FlagDraft[]
  onFlagsChange: (next: FlagDraft[]) => void
  onSubmit: (confirmEmpty: boolean) => void
  submitting?: boolean
  submitError?: unknown
}

const EMPTY_LOCATION: FlagLocation = { file_path: '', line_start: 0, line_end: 0 }

export function FlagPanel({
  levelNo,
  files,
  activePath,
  selection,
  limits,
  flags,
  onFlagsChange,
  onSubmit,
  submitting = false,
  submitError,
}: FlagPanelProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [linesText, setLinesText] = useState<Record<string, string>>({})
  const [placeholders, setPlaceholders] = useState<string[]>([])
  const [emptyConfirmArmed, setEmptyConfirmArmed] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [seenSubmitError, setSeenSubmitError] = useState<unknown>(submitError)

  // Server-side field errors from a rejected submit land on the fields of the
  // single-flag case, where the mapping is unambiguous. With several flags the
  // server response does not name one, so the parent banner carries the detail.
  // Adjusted during render when the submitError prop changes (React derived
  // state pattern), not in an effect.
  if (seenSubmitError !== submitError) {
    setSeenSubmitError(submitError)
    setServerErrors(mapServerErrorToFieldErrors(submitError, flags.length))
  }

  const summary = flagIssuesSummary(flags, levelNo, files, limits)
  const current = activeIndex !== null && activeIndex >= 0 && activeIndex < flags.length ? activeIndex : null
  const currentFlag = current !== null ? flags[current] : null
  const currentErrors: Record<string, string> = current !== null ? errorsFor(current) : {}

  function markTouched(key: string) {
    setTouched((prev) => ({ ...prev, [key]: true }))
  }

  function updateFlag(index: number, patch: Partial<FlagDraft>) {
    onFlagsChange(flags.map((f, k) => (k === index ? { ...f, ...patch } : f)))
    if (index === 0) setServerErrors({})
  }

  function errorsFor(index: number): Record<string, string> {
    const errs = validateFlag(flags[index], levelNo, files, limits)
    return index === 0 ? { ...errs, ...serverErrors } : errs
  }

  /** Inline error only once the field was touched or a submit was attempted. */
  function visibleError(errs: Record<string, string>, index: number, key: string): string | undefined {
    if (!touched[`${index}:${key}`] && !submitAttempted) return undefined
    return errs[key]
  }

  function addFlag() {
    if (flags.length >= limits.maxFlags) return
    const index = flags.length
    const first: FlagLocation = { file_path: activePath ?? '', line_start: 0, line_end: 0 }
    // Autofill lines only when the selection belongs to the file being filled,
    // so a stale selection from another file never lands under the new path.
    if (selection && (selection.path === activePath || activePath === null)) {
      first.line_start = selection.start
      first.line_end = selection.end
    }
    onFlagsChange([
      ...flags,
      { title: '', category: '', description: '', evidence: null, claimed_severity: null, locations: [first] },
    ])
    setPlaceholders((prev) => [...prev, randomPlaceholder()])
    setLinesText((prev) => ({ ...prev, [`${index}:0`]: fmtLines(first) }))
    setActiveIndex(index)
    setEmptyConfirmArmed(false)
    setServerErrors({})
  }

  function deleteFlag(index: number) {
    onFlagsChange(flags.filter((_, k) => k !== index))
    setPlaceholders((prev) => prev.filter((_, k) => k !== index))
    setTouched((prev) => rekeyAfterFlagRemoval(prev, index))
    setLinesText((prev) => rekeyAfterFlagRemoval(prev, index))
    setActiveIndex((prev) => {
      if (prev === null || prev === index) return null
      return prev > index ? prev - 1 : prev
    })
    setServerErrors({})
  }

  function addLocation(index: number) {
    const flag = flags[index]
    if (flag.locations.length >= limits.maxLocations) return
    updateFlag(index, { locations: [...flag.locations, { ...EMPTY_LOCATION }] })
  }

  function removeLocation(index: number, row: number) {
    updateFlag(index, { locations: flags[index].locations.filter((_, k) => k !== row) })
    const shift = (r: number): number | null => (r === row ? null : r > row ? r - 1 : r)
    setTouched((prev) => rekeyLocationFields(prev, index, shift))
    setLinesText((prev) => rekeyRowNumbers(prev, index, shift))
  }

  function moveLocation(index: number, row: number, dir: -1 | 1) {
    const target = row + dir
    const rows = flags[index].locations.length
    if (target < 0 || target >= rows) return
    const locations = [...flags[index].locations]
    const swap = locations[row]
    locations[row] = locations[target]
    locations[target] = swap
    updateFlag(index, { locations })
    const swapRows = (r: number): number | null => (r === row ? target : r === target ? row : r)
    setTouched((prev) => rekeyLocationFields(prev, index, swapRows))
    setLinesText((prev) => rekeyRowNumbers(prev, index, swapRows))
  }

  /** Level 1 rows always edit a one-element array, even for a degenerate draft. */
  function patchLocation(index: number, row: number, patch: Partial<FlagLocation>) {
    const flag = flags[index]
    if (levelNo === 1) {
      const base = flag.locations[row] ?? EMPTY_LOCATION
      updateFlag(index, { locations: [{ ...base, ...patch }] })
      return
    }
    updateFlag(index, { locations: flag.locations.map((loc, k) => (k === row ? { ...loc, ...patch } : loc)) })
  }

  function changeLines(index: number, row: number, raw: string) {
    setLinesText((prev) => ({ ...prev, [`${index}:${row}`]: raw }))
    const parsed = parseLines(raw)
    patchLocation(index, row, { line_start: parsed ? parsed.start : 0, line_end: parsed ? parsed.end : 0 })
  }

  function handleSubmit() {
    if (submitting) return
    if (flags.length === 0) {
      setEmptyConfirmArmed(true)
      return
    }
    setSubmitAttempted(true)
    let bad: number | null = null
    for (let i = 0; i < flags.length; i++) {
      if (Object.keys(errorsFor(i)).length > 0) {
        bad = i
        break
      }
    }
    if (bad !== null) {
      if (activeIndex !== bad) setActiveIndex(bad)
      const id = firstInvalidFieldId(bad, errorsFor(bad))
      window.setTimeout(() => focusById(id), 0)
      return
    }
    onSubmit(false)
  }

  function firstInvalidFieldId(index: number, errs: Record<string, string>): string {
    const simpleOrder: Array<[string, string]> = [
      ['title', `flag-title-${index}`],
      ['category', `flag-category-${index}`],
      ['description', `flag-description-${index}`],
      ['evidence', `flag-evidence-${index}`],
      ['claimed_severity', `flag-severity-${index}`],
    ]
    for (const [key, id] of simpleOrder) {
      if (errs[key] !== undefined) return id
    }
    const rows = flags[index].locations.length
    if (rows === 0) return `flag-add-location-${index}`
    for (let r = 0; r < rows; r++) {
      if (errs[`locations[${r}].file_path`] !== undefined) return `flag-loc-file-${index}-${r}`
      if (errs[`locations[${r}].lines`] !== undefined) return `flag-loc-lines-${index}-${r}`
    }
    if (errs['locations'] !== undefined) return `flag-loc-file-${index}-0`
    return `flag-title-${index}`
  }

  function focusById(id: string) {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.focus()
  }

  return (
    <Panel
      as="section"
      ariaLabel="Bug report flags"
      title={`Level ${levelNo} bug reports`}
      bodyClassName="panel-body stack"
      actions={
        <>
          <Chip tone="muted" size="sm" title="Flags filed against the level cap">
            {flags.length}/{limits.maxFlags} flags
          </Chip>
          <Button size="sm" onClick={addFlag} disabled={flags.length >= limits.maxFlags}>
            + Add flag
          </Button>
        </>
      }
    >
      <span className="sr-only" aria-live="polite">
        {summary}
      </span>

      {files.length > 0 && (
        <datalist id="flag-file-options">
          {files.map((f) => (
            <option key={f.path} value={f.path} />
          ))}
        </datalist>
      )}

      {flags.length === 0 ? (
        <EmptyState
          title="No flags yet"
          note="Select lines in the code viewer, then add a flag. The open file and the selected lines autofill the first location."
        />
      ) : (
        <div className="flag-list">
          {flags.map((flag, i) => {
            const errs = errorsFor(i)
            const issues = Object.keys(errs).length
            return (
              <div className="flag-row" key={i}>
                <button
                  type="button"
                  className={`flag-row-select ${current === i ? 'active' : ''}`}
                  aria-current={current === i ? 'true' : undefined}
                  onClick={() => setActiveIndex(i)}
                  title={flag.title.trim() !== '' ? flag.title.trim() : 'Untitled flag'}
                >
                  <FlagIcon size={13} />
                  <span className="mono small" style={{ flex: 'none' }}>
                    Flag {i + 1}
                  </span>
                  <span className="small flag-row-title">
                    {flag.title.trim() !== '' ? flag.title.trim() : 'Untitled flag'}
                  </span>
                  <Chip tone={issues === 0 ? 'ok' : 'warn'}>
                    {issues === 0 ? 'Ready' : `${issues} issue${issues === 1 ? '' : 's'}`}
                  </Chip>
                </button>
                <ConfirmButton
                  label="Delete"
                  confirmLabel="Confirm delete"
                  variant="danger"
                  title={`Delete flag ${i + 1}`}
                  onConfirm={() => deleteFlag(i)}
                />
              </div>
            )
          })}
        </div>
      )}

      {current !== null && currentFlag !== null && (
        <div className="flag-editor">
          <div className="flag-loc-head">
            <span className="overline" style={{ color: 'var(--signal)' }}>
              Flag {current + 1} of {flags.length}
            </span>
            <span style={{ flex: 1 }} />
          </div>

          <Field
            label="Title"
            htmlFor={`flag-title-${current}`}
            required
            error={visibleError(currentErrors, current, 'title')}
            hint={`${currentFlag.title.length}/120`}
          >
            <input
              id={`flag-title-${current}`}
              className="input"
              maxLength={120}
              value={currentFlag.title}
              onChange={(e) => updateFlag(current, { title: e.target.value })}
              onBlur={() => markTouched(`${current}:title`)}
              placeholder="What fails, in one line"
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field
              label="Category"
              htmlFor={`flag-category-${current}`}
              required
              error={visibleError(currentErrors, current, 'category')}
            >
              <div className="select-wrap">
                <select
                  id={`flag-category-${current}`}
                  className="select"
                  value={currentFlag.category}
                  onChange={(e) => updateFlag(current, { category: e.target.value })}
                  onBlur={() => markTouched(`${current}:category`)}
                >
                  <option value="">Select category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field
              label="Claimed severity"
              htmlFor={`flag-severity-${current}`}
              hint="Optional; scoring uses ground truth."
              error={visibleError(currentErrors, current, 'claimed_severity')}
            >
              <div className="select-wrap">
                <select
                  id={`flag-severity-${current}`}
                  className="select"
                  value={currentFlag.claimed_severity ?? ''}
                  onChange={(e) =>
                    updateFlag(current, { claimed_severity: e.target.value === '' ? null : (e.target.value as Severity) })
                  }
                  onBlur={() => markTouched(`${current}:claimed_severity`)}
                >
                  <option value="">Not claimed</option>
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
          </div>

          <Field
            label="Description"
            htmlFor={`flag-description-${current}`}
            required
            error={visibleError(currentErrors, current, 'description')}
            hint={`${currentFlag.description.trim().length}/2000, min 20`}
          >
            <textarea
              id={`flag-description-${current}`}
              className="textarea"
              maxLength={2000}
              value={currentFlag.description}
              onChange={(e) => updateFlag(current, { description: e.target.value })}
              onBlur={() => markTouched(`${current}:description`)}
              placeholder={placeholders[current] ?? DESCRIPTION_PLACEHOLDERS[0]}
            />
          </Field>

          <Field
            label="Evidence"
            htmlFor={`flag-evidence-${current}`}
            error={visibleError(currentErrors, current, 'evidence')}
            hint={`Optional, ${(currentFlag.evidence ?? '').length}/2000.`}
          >
            <textarea
              id={`flag-evidence-${current}`}
              className="textarea mono"
              maxLength={2000}
              style={{ minHeight: 56 }}
              value={currentFlag.evidence ?? ''}
              onChange={(e) => updateFlag(current, { evidence: e.target.value === '' ? null : e.target.value })}
              onBlur={() => markTouched(`${current}:evidence`)}
              placeholder="Log lines, request and output snippets, exact values observed."
            />
          </Field>

          <div style={{ display: 'grid', gap: 8 }}>
            <div className="flag-loc-head">
              <span className="field-label" style={{ color: 'var(--paper)' }}>
                Locations
              </span>
              {levelNo === 2 && (
                <Chip tone="muted" size="sm" title="Locations used against the cap">
                  {currentFlag.locations.length}/{limits.maxLocations}
                </Chip>
              )}
              <span style={{ flex: 1 }} />
              {levelNo === 2 && (
                <button
                  type="button"
                  id={`flag-add-location-${current}`}
                  className="btn btn-sm"
                  onClick={() => addLocation(current)}
                  disabled={currentFlag.locations.length >= limits.maxLocations}
                >
                  + Add location
                </button>
              )}
            </div>
            <span className="muted small">
              {levelNo === 1
                ? 'Level 1 flags carry exactly one location.'
                : `1 to ${limits.maxLocations} ordered locations. Order is kept exactly as listed.`}
            </span>
            {visibleError(currentErrors, current, 'locations') !== undefined && (
              <div className="field-error" role="alert">
                {visibleError(currentErrors, current, 'locations')}
              </div>
            )}
            {(levelNo === 1 ? [currentFlag.locations[0] ?? EMPTY_LOCATION] : currentFlag.locations).map((loc, r) => {
              const rowFile = files.find((f) => f.path === loc.file_path)
              return (
                <div className="flag-loc" key={r}>
                  <div className="flag-loc-head">
                    <span className="mono small" style={{ color: 'var(--signal)' }}>
                      {levelNo === 1 ? 'Location' : `Location ${r + 1}`}
                    </span>
                    {rowFile !== undefined && <span className="muted small mono">{rowFile.line_count} lines in file</span>}
                    {levelNo === 2 && <span style={{ flex: 1 }} />}
                    {levelNo === 2 && (
                      <>
                        <Button
                          size="sm"
                          disabled={r === 0}
                          onClick={() => moveLocation(current, r, -1)}
                          ariaLabel={`Move location ${r + 1} up`}
                          title="Move up"
                        >
                          Up
                        </Button>
                        <Button
                          size="sm"
                          disabled={r === currentFlag.locations.length - 1}
                          onClick={() => moveLocation(current, r, 1)}
                          ariaLabel={`Move location ${r + 1} down`}
                          title="Move down"
                        >
                          Down
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => removeLocation(current, r)}
                          ariaLabel={`Remove location ${r + 1}`}
                        >
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                  <Field
                    label="File"
                    htmlFor={`flag-loc-file-${current}-${r}`}
                    required
                    error={visibleError(currentErrors, current, `locations[${r}].file_path`)}
                  >
                    <input
                      id={`flag-loc-file-${current}-${r}`}
                      className="input mono-input"
                      list={files.length > 0 ? 'flag-file-options' : undefined}
                      value={loc.file_path}
                      onChange={(e) => patchLocation(current, r, { file_path: e.target.value })}
                      onBlur={() => markTouched(`${current}:locations[${r}].file_path`)}
                      placeholder="routes/notes.js"
                      spellCheck={false}
                    />
                  </Field>
                  <Field
                    label="Lines"
                    htmlFor={`flag-loc-lines-${current}-${r}`}
                    required
                    error={visibleError(currentErrors, current, `locations[${r}].lines`)}
                    hint="One line like 12 or a range like 12-18."
                  >
                    <input
                      id={`flag-loc-lines-${current}-${r}`}
                      className="input mono-input"
                      inputMode="numeric"
                      value={linesText[`${current}:${r}`] ?? fmtLines(loc)}
                      onChange={(e) => changeLines(current, r, e.target.value)}
                      onBlur={() => markTouched(`${current}:locations[${r}].lines`)}
                      placeholder="12 or 12-18"
                      spellCheck={false}
                    />
                  </Field>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, display: 'grid', gap: 10 }}>
        {emptyConfirmArmed && flags.length === 0 && (
          <div className="banner banner-tone-warn" role="alert">
            <span className="banner-title">Empty submission</span>
            <div className="small">
              Sending now records a submission with zero flags. Nothing gets scored for this level and the receipt
              cannot be changed afterwards. Confirm only if you are done and intentionally reporting no findings.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="primary" size="sm" onClick={() => onSubmit(true)}>
                Confirm empty submission
              </Button>
              <Button size="sm" onClick={() => setEmptyConfirmArmed(false)}>
                Go back
              </Button>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            <SubmitArrowIcon size={14} />
            {submitting ? 'Submitting' : 'Submit level'}
          </Button>
          <span className="muted small mono">{summary}</span>
        </div>
      </div>
    </Panel>
  )
}

export default FlagPanel

/** Maps ApiRequestError.details keys onto flag field error keys; empty when not applicable. */
function mapServerErrorToFieldErrors(submitError: unknown, flagCount: number): Record<string, string> {
  if (!(submitError instanceof ApiRequestError)) return {}
  const details = submitError.details
  if (!details || typeof details !== 'object' || flagCount !== 1) return {}
  const mapped: Record<string, string> = {}
  for (const [key, value] of Object.entries(details)) {
    const fieldKey = key === 'line_range' ? 'locations[0].lines' : key === 'file_path' ? 'locations[0].file_path' : key
    mapped[fieldKey] = String(value)
  }
  return mapped
}

/* ---- touched/lines key plumbing: keys look like "2:title", "2:locations[0].lines", "2:0" ---- */

/** After flag `removed` is deleted, drop its keys and shift later flags down. */
function rekeyAfterFlagRemoval<T>(prev: Record<string, T>, removed: number): Record<string, T> {
  const out: Record<string, T> = {}
  for (const key of Object.keys(prev)) {
    const sep = key.indexOf(':')
    const head = sep === -1 ? key : key.slice(0, sep)
    const rest = sep === -1 ? '' : key.slice(sep + 1)
    const idx = Number(head)
    if (Number.isNaN(idx) || head === '') {
      out[key] = prev[key]
      continue
    }
    if (idx === removed) continue
    out[`${idx > removed ? idx - 1 : idx}:${rest}`] = prev[key]
  }
  return out
}

/** Remap the locations[r] row index inside one flag's keys; null drops the key. */
function rekeyLocationFields<T>(
  prev: Record<string, T>,
  flagIndex: number,
  mapRow: (row: number) => number | null,
): Record<string, T> {
  const prefix = `${flagIndex}:locations[`
  const out: Record<string, T> = {}
  for (const key of Object.keys(prev)) {
    if (!key.startsWith(prefix)) {
      out[key] = prev[key]
      continue
    }
    const close = key.indexOf(']', prefix.length)
    if (close === -1) {
      out[key] = prev[key]
      continue
    }
    const row = Number(key.slice(prefix.length, close))
    if (Number.isNaN(row)) {
      out[key] = prev[key]
      continue
    }
    const mapped = mapRow(row)
    if (mapped === null) continue
    out[`${flagIndex}:locations[${mapped}]${key.slice(close + 1)}`] = prev[key]
  }
  return out
}

/** Remap the bare row number in "flag:row" lines-text keys; null drops the key. */
function rekeyRowNumbers<T>(
  prev: Record<string, T>,
  flagIndex: number,
  mapRow: (row: number) => number | null,
): Record<string, T> {
  const prefix = `${flagIndex}:`
  const out: Record<string, T> = {}
  for (const [key, value] of Object.entries(prev)) {
    if (!key.startsWith(prefix)) {
      out[key] = value
      continue
    }
    const field = key.slice(prefix.length)
    if (!/^\d+$/.test(field)) {
      out[key] = value
      continue
    }
    const mapped = mapRow(Number(field))
    if (mapped === null) continue
    out[`${prefix}${mapped}`] = value
  }
  return out
}
