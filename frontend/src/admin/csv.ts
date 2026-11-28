export interface CsvParsedRow {
  raw: Record<string, string>
  line: number
}

export function parseCsv(text: string): { headers: string[]; rows: CsvParsedRow[] } {
  const records: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0
  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    records.push(row)
    row = []
  }
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      pushField()
    } else if (ch === '\n') {
      pushRow()
    } else if (ch === '\r') {
    } else {
      field += ch
    }
    i++
  }
  if (field.length > 0 || row.length > 0) pushRow()

  const nonEmpty = records.filter((r) => r.some((c) => c.trim().length > 0))
  if (nonEmpty.length === 0) return { headers: [], rows: [] }
  const headers = nonEmpty[0].map((h) => h.trim())
  const rows = nonEmpty.slice(1).map((cells, idx) => {
    const raw: Record<string, string> = {}
    headers.forEach((h, ci) => {
      raw[h] = (cells[ci] ?? '').trim()
    })
    return { raw, line: idx + 2 }
  })
  return { headers, rows }
}

export const PARTICIPANT_REQUIRED_FIELDS = ['name', 'email'] as const

export interface CsvRowIssue {
  field: string
  message: string
}

export function validateParticipantRow(raw: Record<string, string>): CsvRowIssue[] {
  const issues: CsvRowIssue[] = []
  const name = raw.name ?? raw.Name ?? ''
  const email = raw.email ?? raw.Email ?? ''
  if (!name) issues.push({ field: 'name', message: 'Missing required field: name' })
  if (!email) issues.push({ field: 'email', message: 'Missing required field: email' })
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) issues.push({ field: 'email', message: `Invalid email: ${email}` })
  return issues
}

export function normalizeParticipantRow(raw: Record<string, string>): {
  id: string
  name: string
  email: string
  team: string
  registrationStatus: string
  participationStatus: string
  registeredAt: string
} {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== '') return raw[k]
      const lower = k.toLowerCase()
      for (const key of Object.keys(raw)) {
        if (key.toLowerCase() === lower && raw[key] !== '') return raw[key]
      }
    }
    return ''
  }
  return {
    id: pick('id', 'participant_id', 'Participant ID', 'participant id'),
    name: pick('name', 'Name', 'full name'),
    email: pick('email', 'Email').toLowerCase(),
    team: pick('team', 'Team', 'team name'),
    registrationStatus: pick('registration_status', 'registration status', 'status') || 'registered',
    participationStatus: pick('participation_status', 'participation status') || 'active',
    registeredAt: pick('registered_at', 'registration timestamp', 'registered', 'timestamp'),
  }
}
