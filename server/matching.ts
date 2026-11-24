export interface GtLocation {
  file_path: string
  line_start: number
  line_end: number
  is_primary: boolean
}

export interface GtBugView {
  bug_id: string
  code: string
  points: number
  category: string
  severity: string
  root_cause_group: string
  aliases: [string, number][]
  locations: GtLocation[]
}

export interface MatchFeatures {
  location_score: number
  category_score: number
  alias_evidence: number
  span: number
  distance: number | null
}

export interface MatchDecision {
  outcome: 'accept_full' | 'accept_partial' | 'reject_invalid' | 'needs_review' | 'duplicate'
  bug: GtBugView | null
  features: MatchFeatures
  explanation: string
}

const CATEGORIES_FAMILIES: Record<string, string[]> = {
  logic: ['logic', 'error_handling', 'other'],
  input_validation: ['input_validation', 'logic', 'other'],
  authentication_authorization: ['authentication_authorization', 'other'],
  injection: ['injection', 'input_validation'],
  cryptography: ['cryptography', 'other'],
  resource_handling: ['resource_handling', 'logic'],
  concurrency: ['concurrency', 'logic'],
  error_handling: ['error_handling', 'logic'],
  configuration: ['configuration', 'other'],
  integration_api_contract: ['integration_api_contract', 'logic'],
  data_handling: ['data_handling', 'logic', 'input_validation'],
  other: ['other'],
}

function normalize(text: string): string {
  return (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim()
}

function locationDistance(a: [number, number], b: [number, number]): number {
  const [a0, a1] = a
  const [b0, b1] = b
  if (a1 < b0) return b0 - a1
  if (b1 < a0) return a0 - b1
  return 0
}

function locationScore(reportRange: [number, number], loc: GtLocation, tolerance: number): number {
  const dist = locationDistance(reportRange, [loc.line_start, loc.line_end])
  if (dist === 0 || dist <= tolerance) return 1.0
  const window = 10 - tolerance
  if (window <= 0) return 0.0
  return Math.max(0.0, 1.0 - (dist - tolerance) / window)
}

function aliasEvidence(reportText: string, aliases: [string, number][]): number {
  const textN = normalize(reportText)
  if (aliases.length === 0) return 0.0
  const totalWeight = aliases.reduce((sum, [, w]) => sum + w, 0) || 1.0
  const hit = aliases.reduce((sum, [kw, w]) => (textN.includes(normalize(kw)) ? sum + w : sum), 0)
  return hit / totalWeight
}

export function decide(
  report: Record<string, unknown>,
  candidates: GtBugView[],
  ruleSet: { location_tolerance_lines?: number; max_span?: number; min_description_chars?: number },
  alreadyAwardedUnits: Set<string>,
): MatchDecision {
  const tol = Number(ruleSet.location_tolerance_lines ?? 2)
  const maxSpan = Number(ruleSet.max_span ?? 25)
  const minDesc = Number(ruleSet.min_description_chars ?? 40)
  const filePath = String(report.file_path ?? '')
  const ls = Number(report.line_start ?? 0)
  const le = Number(report.line_end ?? 0)
  const span = Math.max(0, le - ls + 1)
  const desc = `${String(report.description ?? '')} ${String(report.evidence ?? '')}`
  const cat = String(report.category ?? '')

  if (span > maxSpan) {
    return {
      outcome: 'reject_invalid',
      bug: null,
      features: { location_score: 0, category_score: 0, alias_evidence: 0, span, distance: null },
      explanation: 'span exceeds max_span',
    }
  }
  if (!filePath) {
    return {
      outcome: 'reject_invalid',
      bug: null,
      features: { location_score: 0, category_score: 0, alias_evidence: 0, span, distance: null },
      explanation: 'missing file_path',
    }
  }

  const scored: { combined: number; locScore: number; catScore: number; bug: GtBugView; feats: MatchFeatures }[] = []

  for (const bug of candidates) {
    let bestLoc = 0.0
    let bestDist: number | null = null
    for (const loc of bug.locations) {
      if (loc.file_path !== filePath) continue
      const s = locationScore([ls, le], loc, tol)
      const d = locationDistance([ls, le], [loc.line_start, loc.line_end])
      if (s > bestLoc || bestDist === null) {
        bestLoc = s
        bestDist = d
      }
    }
    let catScore = 0.0
    const fam = CATEGORIES_FAMILIES[cat] ?? []
    if (cat && bug.category === cat) catScore = 1.0
    else if (fam.includes(bug.category)) catScore = 0.6

    const alScore = aliasEvidence(desc, bug.aliases)
    const feats: MatchFeatures = {
      location_score: bestLoc,
      category_score: catScore,
      alias_evidence: alScore,
      span,
      distance: bestDist,
    }
    const combined = bestLoc * Math.max(catScore, alScore * 0.5 + catScore * 0.5)
    scored.push({ combined, locScore: bestLoc, catScore, bug, feats })
  }

  if (scored.length === 0) {
    if (desc.trim().length >= minDesc) {
      return {
        outcome: 'needs_review',
        bug: null,
        features: { location_score: 0, category_score: 0, alias_evidence: 0, span, distance: null },
        explanation: 'no candidate in same file; plausible report routed to review',
      }
    }
    return {
      outcome: 'reject_invalid',
      bug: null,
      features: { location_score: 0, category_score: 0, alias_evidence: 0, span, distance: null },
      explanation: 'unmatched and too thin to review',
    }
  }

  scored.sort((a, b) => b.combined - a.combined || b.locScore - a.locScore || b.catScore - a.catScore)
  const top = scored[0]
  const { locScore: L, catScore: C, bug, feats } = top

  if (alreadyAwardedUnits.has(bug.code)) {
    return { outcome: 'duplicate', bug, features: feats, explanation: `award unit ${bug.code} already claimed` }
  }

  const autoFull = L >= 0.9 && C >= 0.6 && feats.alias_evidence >= 0.2
  const autoPartial = L >= 0.9 && C === 0

  if (autoFull) {
    return { outcome: 'accept_full', bug, features: feats, explanation: 'location, category and alias evidence aligned' }
  }
  if (autoPartial) {
    return {
      outcome: 'accept_partial',
      bug,
      features: feats,
      explanation: 'location aligned; category unconfirmed, routed for confirmation',
    }
  }
  if (L === 0 && feats.alias_evidence === 0 && desc.trim().length < minDesc) {
    return {
      outcome: 'reject_invalid',
      bug: null,
      features: feats,
      explanation: 'no location or alias evidence and description too short',
    }
  }
  return { outcome: 'needs_review', bug, features: feats, explanation: 'borderline match routed to human review' }
}
