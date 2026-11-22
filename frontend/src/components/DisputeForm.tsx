import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiRequestError } from '../lib/api'
import { ConfirmButton, Field } from '../ui/components'
import { CheckIcon } from '../ui/icons'

// Dispute filing against a released verdict.
// POST /v1/submissions/{id}/dispute {statement} -> 201. The server answers
// VALIDATION_ERROR with details.dispute when feedback is not released yet and
// NOT_FOUND when the submission does not belong to the caller.

const MIN_STATEMENT = 10
const MAX_STATEMENT = 1000

export function DisputeForm({ submissionId, receiptCode, idPrefix }: { submissionId: string; receiptCode?: string | null; idPrefix?: string }) {
  const queryClient = useQueryClient()
  const [statement, setStatement] = useState('')
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const inputId = `${idPrefix ?? 'dispute'}-statement`

  async function submit() {
    setFieldError(null)
    setServerError(null)
    const trimmed = statement.trim()
    if (trimmed.length < MIN_STATEMENT) {
      setFieldError(`Describe the dispute in at least ${MIN_STATEMENT} characters.`)
      return
    }
    if (trimmed.length > MAX_STATEMENT) {
      setFieldError(`Keep the statement under ${MAX_STATEMENT} characters.`)
      return
    }
    setBusy(true)
    try {
      await api<{ ok: boolean }>(`/v1/submissions/${submissionId}/dispute`, {
        method: 'POST',
        body: { statement: trimmed },
      })
      setDone(true)
      void queryClient.invalidateQueries({ queryKey: ['submission', submissionId] })
      void queryClient.invalidateQueries({ queryKey: ['results'] })
      void queryClient.invalidateQueries({ queryKey: ['submissions'] })
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'NOT_FOUND') {
          setServerError('This submission was not found among your own filings, so no dispute was recorded.')
        } else if (err.code === 'VALIDATION_ERROR') {
          const disputeDetail = typeof err.details.dispute === 'string' ? err.details.dispute : null
          setServerError(disputeDetail ?? err.serverMessage)
        } else {
          setServerError(err.serverMessage)
        }
      } else {
        setServerError('Dispute filing failed unexpectedly.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="banner banner-tone-ok" role="status">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <CheckIcon size={15} />
          <span className="banner-title">Dispute recorded; the organizers will review it</span>
        </div>
        {receiptCode && (
          <div className="small mono">receipt {receiptCode}</div>
        )}
      </div>
    )
  }

  return (
    <div className="stack" style={{ gap: 10 }} aria-label="Dispute this result">
      <Field
        label="Dispute statement"
        htmlFor={inputId}
        required
        hint={`${statement.trim().length}/${MAX_STATEMENT}, min ${MIN_STATEMENT}. State what the verdict got wrong; the organizers review disputes in the announced window.`}
        error={fieldError}
      >
        <textarea
          id={inputId}
          className="textarea"
          value={statement}
          maxLength={MAX_STATEMENT}
          style={{ minHeight: 84 }}
          onChange={(e) => setStatement(e.target.value)}
          placeholder="Which entry is wrong, and what should the organizers re-check?"
        />
      </Field>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <ConfirmButton
          label="Dispute this result"
          confirmLabel="Confirm dispute"
          variant="primary"
          disabled={busy || statement.trim().length === 0}
          onConfirm={() => void submit()}
        />
        {busy && <span className="loading-inline" role="status">Recording dispute</span>}
      </div>
      {serverError && (
        <div className="field-error" role="alert">{serverError}</div>
      )}
    </div>
  )
}
