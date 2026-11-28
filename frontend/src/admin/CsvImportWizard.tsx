import { useMemo, useState } from 'react'
import { Button, Field, Chip, EmptyState } from '../ui/components'
import { parseCsv, validateParticipantRow, normalizeParticipantRow, type CsvRowIssue } from './csv'
import { useAdmin } from './store'
import { Modal, useToast } from './ui'
import type { CsvImportRow } from './store'

type Step = 'upload' | 'review' | 'result'

interface PreparedRow extends CsvImportRow {
  line: number
  issues: CsvRowIssue[]
  duplicate: boolean
  duplicateReason: string | null
}

export function CsvImportWizard({ onClose }: { onClose: () => void }) {
  const { state, importParticipants } = useAdmin()
  const toast = useToast()
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [prepared, setPrepared] = useState<PreparedRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; duplicates: number; failed: number } | null>(null)

  const counts = useMemo(() => {
    const invalid = prepared.filter((r) => r.issues.length > 0).length
    const dup = prepared.filter((r) => r.duplicate).length
    const valid = prepared.filter((r) => r.issues.length === 0 && !r.duplicate).length
    return { invalid, dup, valid, total: prepared.length }
  }, [prepared])

  function onFile(file: File | null) {
    setParseError(null)
    setResult(null)
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onerror = () => setParseError('Could not read the file.')
    reader.onload = () => {
      const text = String(reader.result ?? '')
      try {
        const { headers: h, rows } = parseCsv(text)
        setHeaders(h)
        const existingIds = new Set(state.participants.map((p) => p.id.toLowerCase()))
        const existingEmails = new Set(state.participants.map((p) => p.email.toLowerCase()))
        const seenIds = new Set<string>()
        const seenEmails = new Set<string>()
        const prep: PreparedRow[] = rows.map((r) => {
          const issues = validateParticipantRow(r.raw)
          const norm = normalizeParticipantRow(r.raw)
          const idKey = (norm.id || '').toLowerCase()
          const emailKey = norm.email.toLowerCase()
          let duplicate = false
          let duplicateReason: string | null = null
          if (norm.id && (existingIds.has(idKey) || seenIds.has(idKey))) { duplicate = true; duplicateReason = `duplicate participant ID: ${norm.id}` }
          else if (norm.email && (existingEmails.has(emailKey) || seenEmails.has(emailKey))) { duplicate = true; duplicateReason = `duplicate email: ${norm.email}` }
          if (norm.id) seenIds.add(idKey)
          if (norm.email) seenEmails.add(emailKey)
          return { ...norm, line: r.line, issues, duplicate, duplicateReason }
        })
        setPrepared(prep)
        if (h.length === 0) setParseError('No header row found. Expect columns like name,email.')
        setStep('review')
      } catch {
        setParseError('Could not parse this CSV. Check quoting and delimiters.')
      }
    }
    reader.readAsText(file)
  }

  function confirmImport() {
    const rows: CsvImportRow[] = prepared
      .filter((r) => r.issues.length === 0 && !r.duplicate)
      .map((r) => ({ id: r.id, name: r.name, email: r.email, team: r.team, registrationStatus: r.registrationStatus, participationStatus: r.participationStatus, registeredAt: r.registeredAt }))
    const skippedInvalid = prepared.filter((r) => r.issues.length > 0).length
    const skippedDup = prepared.filter((r) => r.duplicate && r.issues.length === 0).length
    const res = importParticipants(rows)
    const final = { created: res.created, duplicates: res.duplicates + skippedDup, failed: res.failed + skippedInvalid }
    setResult(final)
    setStep('result')
    toast.push({ kind: final.failed || final.duplicates ? 'warning' : 'success', title: 'CSV import completed', body: `${final.created} created, ${final.duplicates} duplicates, ${final.failed} failed` })
  }

  return (
    <Modal title="Import participants from CSV" onClose={onClose} wide actions={step === 'review' ? <><Button onClick={() => setStep('upload')}>Back</Button><Button variant="primary" disabled={counts.valid === 0} onClick={confirmImport}>Confirm import ({counts.valid})</Button></> : <Button onClick={onClose}>Close</Button>}>
      {step === 'upload' && (
        <div className="stack" style={{ gap: 14 }}>
          <p className="muted small" style={{ margin: 0 }}>
            Upload a CSV. Nothing is imported on selection; you will review and confirm. Required fields: <span className="mono">name</span>, <span className="mono">email</span>. Optional: <span className="mono">id, team, registration_status, participation_status, registered_at</span>.
          </p>
          <Field label="CSV file" htmlFor="csv-file"><input id="csv-file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0] ?? null)} /></Field>
          {parseError && <div className="field-error" role="alert">{parseError}</div>}
          <div className="panel-2" style={{ padding: 12 }}>
            <span className="overline" style={{ display: 'block', marginBottom: 6 }}>Example</span>
            <pre className="mono small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{'name,email,id,team\nAarav Sharma,aarav.sharma@vitbhopal.ac.in,P-1001,Segfault Saints'}</pre>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="stack" style={{ gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip tone="muted">{fileName}</Chip>
            <Chip tone="ok">{counts.valid} ready</Chip>
            {counts.invalid > 0 && <Chip tone="danger">{counts.invalid} invalid</Chip>}
            {counts.dup > 0 && <Chip tone="warn">{counts.dup} duplicates</Chip>}
            <span className="muted small">Detected columns: {headers.join(', ') || 'none'}</span>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Only valid, non-duplicate rows are imported. Invalid rows are listed above and skipped.</p>
          {prepared.length === 0 ? <EmptyState title="No data rows" note="The CSV has a header but no records." /> : (
            <div className="table-scroll" style={{ maxHeight: 360 }}>
              <table className="table">
                <caption className="sr-only">Import preview</caption>
                <thead><tr><th scope="col">Line</th><th scope="col">Name</th><th scope="col">Email</th><th scope="col">ID</th><th scope="col">Team</th><th scope="col">Validation</th></tr></thead>
                <tbody>
                  {prepared.map((r) => (
                    <tr key={r.line}>
                      <td className="mono small">{r.line}</td>
                      <td className="small">{r.name || <span className="muted">missing</span>}</td>
                      <td className="small">{r.email || <span className="muted">missing</span>}</td>
                      <td className="mono small">{r.id || '-'}</td>
                      <td className="small">{r.team || '-'}</td>
                      <td>
                        {r.issues.length === 0 && !r.duplicate && <Chip tone="ok">ready</Chip>}
                        {r.issues.map((iss, i) => <Chip key={i} tone="danger">{iss.message}</Chip>)}
                        {r.duplicate && <Chip tone="warn">{r.duplicateReason}</Chip>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {step === 'result' && result && (
        <div className="stack" style={{ gap: 12 }}>
          <span className="overline">Import report</span>
          <div className="stat-grid">
            <div className="panel-2" style={{ padding: 12 }}><span className="overline">Successful</span><div className="mono" style={{ fontSize: 24, color: 'var(--ok)' }}>{result.created}</div></div>
            <div className="panel-2" style={{ padding: 12 }}><span className="overline">Failed</span><div className="mono" style={{ fontSize: 24, color: 'var(--danger)' }}>{result.failed}</div></div>
            <div className="panel-2" style={{ padding: 12 }}><span className="overline">Duplicates</span><div className="mono" style={{ fontSize: 24, color: 'var(--warn)' }}>{result.duplicates}</div></div>
          </div>
          <p className="muted small">Imported rows are added to the local sample store. Review participants to verify.</p>
        </div>
      )}
    </Modal>
  )
}
