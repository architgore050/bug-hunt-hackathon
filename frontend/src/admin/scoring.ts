import type { ScoreAdjustment, Team } from './types'

export function penaltiesFor(team: Team, adjustments: ScoreAdjustment[]): number {
  const neg = adjustments.filter((a) => a.teamId === team.id && a.amount < 0).reduce((s, a) => s + -a.amount, 0)
  return team.penalties + neg
}

export function manualPositiveFor(teamId: string, adjustments: ScoreAdjustment[]): number {
  return adjustments.filter((a) => a.teamId === teamId && a.amount > 0).reduce((s, a) => s + a.amount, 0)
}

export function teamTotal(team: Team, adjustments: ScoreAdjustment[]): number {
  return team.functionalScore + team.evaluationScore + team.ctfBonus - penaltiesFor(team, adjustments) + manualPositiveFor(team.id, adjustments)
}
