import type { Participant } from './types'

export function participantsForTeam(teamId: string, participants: Participant[]): Participant[] {
  return participants.filter((p) => p.teamId === teamId && p.participationStatus !== 'removed')
}
