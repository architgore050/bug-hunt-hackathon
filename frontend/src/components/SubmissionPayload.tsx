/**
 * Render the participant-submitted payload as text, never as HTML.
 * React escapes text children; keep this component as the single renderer for
 * the submission-detail payload so this security boundary can be regression-tested.
 */
function payloadLines(payload: Record<string, unknown> | undefined | null): string[] {
  if (!payload) return []
  const out: string[] = []
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined || value === '') continue
    out.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
  }
  return out
}

export function SubmissionPayload({ payload }: { payload: Record<string, unknown> | undefined | null }) {
  return (
    <pre
      className="mono small"
      style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        background: 'var(--panel-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        padding: 14,
        margin: 0,
      }}
    >
      {payloadLines(payload).join('\n') || 'No payload fields.'}
    </pre>
  )
}
