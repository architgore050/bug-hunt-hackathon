import type {
  Activity, AiMessage, CtfQuest, Issue, Level, NotificationItem, Participant,
  Question, Repository, Team, TestResult,
} from '../types'

export interface IssueDraft {
  title: string
  path: string
  line: number
  lineEnd?: number
  category: string
  severity: string
  description: string
  reasoning: string
  expected: string
  actual: string
  level: number
  questionId?: string
}

export interface SubmitResult {
  ok: boolean
  id: string
  message: string
}

/**
 * Boundary between UI and data source. The demo implementation is backed by
 * mock modules; a future API implementation can satisfy the same interface
 * without touching any component.
 */
export interface DataProvider {
  readonly isDemo: boolean
  getCurrentUser(): Promise<Participant>
  getTeam(): Promise<Team>
  getTeams(): Promise<Team[]>
  getLevels(): Promise<Level[]>
  getQuestions(): Promise<Question[]>
  getRepositories(): Promise<Record<string, Repository>>
  getIssues(): Promise<Issue[]>
  getCtfQuests(): Promise<CtfQuest[]>
  getNotifications(): Promise<NotificationItem[]>
  getAiConversation(): Promise<AiMessage[]>
  getActivity(): Promise<Activity[]>
  getTestResults(): Promise<TestResult[]>
  getTerminalLines(): Promise<string[]>
  submitIssue(draft: IssueDraft): Promise<SubmitResult>
  submitFlag(questId: string, value: string): Promise<SubmitResult>
  submitRepair(summary: string): Promise<SubmitResult>
  askAssistant(prompt: string, context?: string): Promise<AiMessage>
  markNotificationsRead(ids: string[]): Promise<void>
}
