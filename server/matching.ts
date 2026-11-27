export interface GtLocation {
  file_path: string
  line_start: number
  line_end: number
  is_primary: boolean
}

export interface GtBugView {
  bug_id: string
  code: string
  title: string
  points: number
  category: string
  severity: string
  root_cause_group: string
  aliases: Array<[string, number]>
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

function aliasEvidence(reportText: string, aliases: Array<[string, number]>): number {
  const textN = normalize(reportText)
  if (!aliases.length) return 0.0
  const totalWeight = aliases.reduce((acc, [, w]) => acc + w, 0) || 1.0
  let hit = 0
  for (const [kw, w] of aliases) {
    if (textN.includes(normalize(kw))) hit += w
  }
  return hit / totalWeight
}

export function decideReport(
  report: {
    file_path?: string | null
    line_start?: number | null
    line_end?: number | null
    description?: string | null
    evidence?: string | null
    category?: string | null
  },
  candidates: GtBugView[],
  ruleSet: Record<string, unknown>,
  alreadyAwardedUnits: Set<string>,
): MatchDecision {
  const tol = Number(ruleSet.location_tolerance_lines ?? 2)
  const maxSpan = Number(ruleSet.max_span ?? 25)
  const minDesc = Number(ruleSet.min_description_chars ?? 40)
  const filePath = report.file_path ?? ''
  const ls = Number(report.line_start ?? 0)
  const le = Number(report.line_end ?? 0)
  const span = Math.max(0, le - ls + 1)
  const desc = `${report.description ?? ''} ${report.evidence ?? ''}`
  const cat = report.category ?? ''

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

  const scored: Array<{
    combined: number
    locScore: number
    catScore: number
    bug: GtBugView
    feats: MatchFeatures
  }> = []

  for (const bug of candidates) {
    let bestLoc = 0
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
    const fam = CATEGORIES_FAMILIES[cat] ?? []
    let catScore = 0
    if (cat && bug.category === cat) catScore = 1.0
    else if (fam.includes(bug.category)) catScore = 0.6
    const alias = aliasEvidence(desc, bug.aliases)
    const combined = bestLoc * Math.max(catScore, alias * 0.5 + catScore * 0.5)
    scored.push({
      combined,
      locScore: bestLoc,
      catScore,
      bug,
      feats: {
        location_score: bestLoc,
        category_score: catScore,
        alias_evidence: alias,
        span,
        distance: bestDist,
      },
    })
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

  scored.sort((a, b) => (b.combined - a.combined) || (b.locScore - a.locScore) || (b.catScore - a.catScore))
  const top = scored[0]

  if (alreadyAwardedUnits.has(top.bug.code)) {
    return {
      outcome: 'duplicate',
      bug: top.bug,
      features: top.feats,
      explanation: `award unit ${top.bug.code} already claimed`,
    }
  }

  if (top.locScore >= 0.9 && top.catScore >= 0.6 && top.feats.alias_evidence >= 0.2) {
    return {
      outcome: 'accept_full',
      bug: top.bug,
      features: top.feats,
      explanation: 'location, category and alias evidence aligned',
    }
  }
  if (top.locScore >= 0.9 && top.catScore === 0) {
    return {
      outcome: 'accept_partial',
      bug: top.bug,
      features: top.feats,
      explanation: 'location aligned; category unconfirmed, routed for confirmation',
    }
  }
  if (top.locScore === 0 && top.feats.alias_evidence === 0 && desc.trim().length < minDesc) {
    return {
      outcome: 'reject_invalid',
      bug: null,
      features: top.feats,
      explanation: 'no location or alias evidence and description too short',
    }
  }
  return {
    outcome: 'needs_review',
    bug: top.bug,
    features: top.feats,
    explanation: 'borderline match routed to human review',
  }
}

export function decideMultiLocation(
  locations: Array<{ file_path: string; line_start: number; line_end: number }>,
  reportText: string,
  category: string,
  candidates: GtBugView[],
  ruleSet: Record<string, unknown>,
  alreadyAwardedUnits: Set<string>,
): MatchDecision {
  const tol = Number(ruleSet.location_tolerance_lines ?? 2)
  const maxSpan = Number(ruleSet.max_span ?? 25)
  const minDesc = Number(ruleSet.min_description_chars ?? 40)

  if (!locations.length) {
    return {
      outcome: 'reject_invalid',
      bug: null,
      features: { location_score: 0, category_score: 0, alias_evidence: 0, span: 0, distance: null },
      explanation: 'no locations supplied',
    }
  }

  if (locations.some((loc) => loc.line_end - loc.line_start + 1 > maxSpan)) {
    return {
      outcome: 'reject_invalid',
      bug: null,
      features: { location_score: 0, category_score: 0, alias_evidence: 0, span: maxSpan + 1, distance: null },
      explanation: 'a location span exceeds max_span',
    }
  }

  const scored: Array<{
    combined: number
    locScore: number
    catScore: number
    bug: GtBugView
    feats: MatchFeatures
  }> = []

  for (const bug of candidates) {
    const perLoc: number[] = []
    for (const loc of locations) {
      let best = 0
      for (const gtLoc of bug.locations) {
        if (gtLoc.file_path !== loc.file_path) continue
        best = Math.max(best, locationScore([loc.line_start, loc.line_end], gtLoc, tol))
      }
      perLoc.push(best)
    }
    const avgLoc = perLoc.reduce((a, b) => a + b, 0) / perLoc.length
    const fam = CATEGORIES_FAMILIES[category] ?? []
    let catScore = 0
    if (category && bug.category === category) catScore = 1.0
    else if (fam.includes(bug.category)) catScore = 0.6
    const alias = aliasEvidence(reportText, bug.aliases)
    const combined = avgLoc * Math.max(catScore, alias * 0.5 + catScore * 0.5)
    scored.push({
      combined,
      locScore: avgLoc,
      catScore,
      bug,
      feats: {
        location_score: avgLoc,
        category_score: catScore,
        alias_evidence: alias,
        span: 0,
        distance: null,
      },
    })
  }

  scored.sort((a, b) => (b.combined - a.combined) || (b.locScore - a.locScore) || (b.catScore - a.catScore))
  const top = scored[0]
  if (!top) {
    return {
      outcome: 'needs_review',
      bug: null,
      features: { location_score: 0, category_score: 0, alias_evidence: 0, span: 0, distance: null },
      explanation: 'no candidates',
    }
  }

  if (alreadyAwardedUnits.has(top.bug.code)) {
    return {
      outcome: 'duplicate',
      bug: top.bug,
      features: top.feats,
      explanation: `award unit ${top.bug.code} already claimed`,
    }
  }

  if (top.locScore >= 0.9 && top.catScore >= 0.6 && top.feats.alias_evidence >= 0.2) {
    return {
      outcome: 'accept_full',
      bug: top.bug,
      features: top.feats,
      explanation: 'multi-location evidence aligned',
    }
  }
  if (top.locScore >= 0.9 && top.catScore === 0) {
    return {
      outcome: 'accept_partial',
      bug: top.bug,
      features: top.feats,
      explanation: 'locations aligned; category unconfirmed',
    }
  }
  if (top.locScore === 0 && top.feats.alias_evidence === 0 && reportText.trim().length < minDesc) {
    return {
      outcome: 'reject_invalid',
      bug: null,
      features: top.feats,
      explanation: 'no location or alias evidence and description too short',
    }
  }
  return {
    outcome: 'needs_review',
    bug: top.bug,
    features: top.feats,
    explanation: 'borderline multi-location match routed to human review',
  }
}
