// Artifact upload dialog for levels 3 and 4 (zip / diff / patch).
//
// Client side checks (extension whitelist case-insensitive, 1..maxBytes size)
// exist for usability only; the server stays authoritative and its rejection
// reason is shown inline. The dialog follows the ConfirmModal pattern: focus
// is trapped, the safe action receives initial focus, Escape and backdrop
// click map to close, and focus returns to the trigger on close.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ApiRequestError } from '../../lib/api'
import { uploadArtifact } from '../../lib/api-levels'
import type { UploadResult } from '../../lib/api-levels'
import { fmtBytes } from '../../lib/format'
import { Button } from '../../ui/components'
import './editable.css'

export interface StagedArtifact {
  artifact_id: string
  kind: string
  filename: string
  size_bytes: number
  entry_count: number | null
}

const ALLOWED_EXTENSIONS = ['zip', 'diff', 'patch']
const DEFAULT_MAX_BYTES = 6 * 1024 * 1024

type UploadPhase = 'idle' | 'uploading' | 'staged'

function extensionOf(filename: string): string {
  const parts = filename.toLowerCase().split('.')
  return parts.length > 1 ? (parts[parts.length - 1] ?? '') : ''
}

/** Client-side usability check; returns a problem string or null when valid. */
function validateFile(file: File, maxBytes: number): string | null {
  if (file.size <= 0) return 'That file is empty (0 bytes). Upload a file with content.'
  if (file.size > maxBytes) return `That file is ${fmtBytes(file.size)}, over the ${fmtBytes(maxBytes)} limit.`
  if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) {
    return 'Only .zip, .diff and .patch files are accepted.'
  }
  return null
}

export function UploadDialog(props: {
  open: boolean
  levelNo: number
  maxBytes?: number
  onClose: () => void
  onStaged: (a: StagedArtifact) => void
}): JSX.Element | null {
  const { open, levelNo, maxBytes = DEFAULT_MAX_BYTES, onClose, onStaged } = props

  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [staged, setStaged] = useState<StagedArtifact | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const busy = phase === 'uploading'

  // Reset the dialog each time it opens; move focus in and remember where to
  // return it on close.
  useEffect(() => {
    if (!open) return
    setPhase('idle')
    setStaged(null)
    setFileError(null)
    setPendingFile(null)
    if (inputRef.current) inputRef.current.value = ''
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      restoreRef.current?.focus?.()
    }
  }, [open])

  const trapFocus = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const container = dialogRef.current
    if (!container) return
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (!busy) onClose()
      return
    }
    trapFocus(e)
  }

  const runUpload = useCallback(
    (file: File) => {
      setPhase('uploading')
      setFileError(null)
      uploadArtifact(levelNo, file)
        .then((result: UploadResult) => {
          const artifact: StagedArtifact = {
            artifact_id: result.artifact_id,
            kind: result.kind,
            filename: result.filename,
            size_bytes: result.size_bytes,
            entry_count: result.entry_count,
          }
          setStaged(artifact)
          setPhase('staged')
          onStaged(artifact)
        })
        .catch((err: unknown) => {
          setPhase('idle')
          if (err instanceof ApiRequestError && err.network) {
            // Keep the file object so Retry uploads the same bytes again.
            setFileError('UPLOAD_NETWORK')
          } else if (err instanceof ApiRequestError) {
            setFileError(err.serverMessage)
          } else {
            setFileError('The upload could not be completed. Try again.')
          }
        })
    },
    [levelNo, onStaged],
  )

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (!file) return
    const problem = validateFile(file, maxBytes)
    if (problem) {
      // Client-side check failed: no upload attempt at all.
      setFileError(problem)
      setPendingFile(null)
      e.target.value = ''
      return
    }
    setPendingFile(file)
    setFileError(null)
    runUpload(file)
  }

  const resetForAnotherFile = () => {
    setPhase('idle')
    setStaged(null)
    setFileError(null)
    setPendingFile(null)
    if (inputRef.current) inputRef.current.value = ''
    inputRef.current?.focus()
  }

  if (!open) return null

  const networkError = fileError === 'UPLOAD_NETWORK'

  return (
    <div
      className="cmodal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="cmodal"
        role="dialog"
        aria-modal="true"
        aria-label="Upload artifact"
        onKeyDown={onKeyDown}
      >
        <h2 className="cmodal-title">Upload artifact</h2>
        <div className="cmodal-body">
          <span>
            Attach a .zip, .diff or .patch file (up to {fmtBytes(maxBytes)}) for level {levelNo}. The platform checks
            the artifact on the server after upload.
          </span>

          {phase !== 'staged' && (
            <input
              ref={inputRef}
              type="file"
              accept=".zip,.diff,.patch"
              disabled={busy}
              onChange={onFileChosen}
              aria-label="Artifact file"
            />
          )}

          {fileError && !networkError && (
            <div className="field-error" role="alert">
              {fileError}
            </div>
          )}

          {networkError && (
            <div className="edlg-warn" role="alert">
              <span>Connection problem. The file was not uploaded.</span>
              {pendingFile && (
                <Button size="sm" onClick={() => pendingFile && runUpload(pendingFile)}>
                  Retry
                </Button>
              )}
            </div>
          )}

          {busy && <span className="edlg-note">Uploading {pendingFile ? pendingFile.name : 'file'}...</span>}

          {phase === 'staged' && staged && (
            <div className="edlg-staged">
              <div className="edlg-staged-row">
                <span className="overline">staged</span>
                <span className="mono">{staged.kind}</span>
              </div>
              <div className="edlg-staged-row">
                <span className="mono">{staged.filename}</span>
              </div>
              <div className="edlg-staged-row">
                <span className="small muted">
                  {fmtBytes(staged.size_bytes)}
                  {staged.entry_count !== null ? ` · ${staged.entry_count} entries` : ''}
                  {' · '}
                  {staged.artifact_id}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="cmodal-actions">
          {phase === 'staged' && (
            <Button size="md" onClick={resetForAnotherFile}>
              Upload another file
            </Button>
          )}
          <button type="button" ref={closeRef} className="btn" onClick={onClose} disabled={busy}>
            {phase === 'staged' ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
