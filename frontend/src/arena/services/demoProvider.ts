import { DEMO_MODE } from '../config'
import { activityFeed, aiConversation, aiSuggestions, terminalLines, testResults } from '../data/ai'
import { ctfQuests } from '../data/ctf'
import { issues } from '../data/issues'
import { levels } from '../data/levels'
import { notifications } from '../data/notifications'
import { currentUser } from '../data/participants'
import { questions } from '../data/questions'
import { repositories } from '../data/repositories'
import { ownTeam, teams } from '../data/teams'
import type { AiMessage, Issue } from '../types'
import type { DataProvider, IssueDraft, SubmitResult } from './provider'

const delay = (ms = 120) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * In-memory demo implementation. All sample records come from ../data and are
 * never imported by UI components directly.
 */
class DemoProvider implements DataProvider {
  readonly isDemo = true
  private issues = [...issues]
  private quests = ctfQuests.map((quest) => ({ ...quest }))
  private notices = notifications.map((notice) => ({ ...notice }))
  private conversation = [...aiConversation]
  private counter = 2000

  async getCurrentUser() { await delay(); return currentUser }
  async getTeam() { await delay(); return ownTeam }
  async getTeams() { await delay(); return teams }
  async getLevels() { await delay(); return levels }
  async getQuestions() { await delay(); return questions }
  async getRepositories() { await delay(); return repositories }
  async getIssues() { await delay(60); return this.issues }
  async getCtfQuests() { await delay(); return this.quests }
  async getNotifications() { await delay(60); return this.notices }
  async getAiConversation() { await delay(); return this.conversation }
  async getActivity() { await delay(); return activityFeed }
  async getTestResults() { await delay(); return testResults }
  async getTerminalLines() { await delay(); return terminalLines }

  async submitIssue(draft: IssueDraft): Promise<SubmitResult> {
    await delay(360)
    this.counter += 1
    const record: Issue = {
      id: `ISS-${this.counter}`,
      title: draft.title,
      path: draft.path,
      line: draft.line,
      lineEnd: draft.lineEnd,
      category: draft.category,
      severity: draft.severity,
      description: draft.description,
      reasoning: draft.reasoning,
      expected: draft.expected,
      actual: draft.actual,
      status: 'submitted',
      points: 0,
      submittedAt: 'Just now',
    }
    this.issues = [record, ...this.issues]
    return { ok: true, id: record.id, message: 'Report queued for review' }
  }

  async submitFlag(questId: string, value: string): Promise<SubmitResult> {
    await delay(320)
    const quest = this.quests.find((item) => item.id === questId)
    if (!quest) return { ok: false, id: questId, message: 'Unknown quest' }
    if (!value.trim()) return { ok: false, id: questId, message: 'Enter a flag value' }
    if (quest.completed) return { ok: false, id: questId, message: 'Quest already completed' }
    if (value.trim().length < 6) return { ok: false, id: questId, message: 'Flag not recognised, try again' }
    this.quests = this.quests.map((item) => item.id === questId ? { ...item, completed: true } : item)
    return { ok: true, id: questId, message: `Flag accepted, +${quest.points} bonus points` }
  }

  async submitRepair(summary: string): Promise<SubmitResult> {
    await delay(420)
    if (!summary.trim()) return { ok: false, id: 'REPAIR', message: 'Describe the repair before submitting' }
    return { ok: true, id: `REP-${this.counter + 1}`, message: 'Repair queued for evaluation' }
  }

  async askAssistant(prompt: string, context?: string): Promise<AiMessage> {
    await delay(620)
    const lower = prompt.toLowerCase()
    let text: string
    if (lower.includes('test') || lower.includes('fail')) {
      text = 'The failing assertions point to the tax calculation. The rate is divided with integer division, so any rate below 100 becomes zero. Use floating point division and keep the discount outside the divisor.'
    } else if (lower.includes('fix') || lower.includes('suggest')) {
      text = 'A minimal fix is to replace the integer division in the pricing helper and persist vote changes in a single tick. Keep the public signatures unchanged so the evaluation suite still matches.'
    } else if (lower.includes('explain')) {
      text = 'This function reads a stored value into a local variable, mutates it later, and writes it back. That pattern is safe for a single request but breaks when requests overlap, because both reads can observe the same starting value.'
    } else {
      text = 'I can work with the selected file context. The likely fault is a mismatch between what the code reads and what it writes. Narrow it down by checking the value at each step, then confirm with the failing test.'
    }
    return { id: `AI-${Date.now()}`, role: 'assistant', text, context: context || aiSuggestions[0] }
  }

  async markNotificationsRead(ids: string[]): Promise<void> {
    await delay()
    this.notices = this.notices.map((notice) => ids.includes(notice.id) ? { ...notice, read: true } : notice)
  }
}

/** Real API provider would be selected here when DEMO_MODE is false. */
class PlaceholderProvider implements DataProvider {
  readonly isDemo = false
  private unavailable = { ok: false, id: '', message: 'Connect the live API provider' }
  private fail(): Promise<never> { return Promise.reject(new Error('Live provider not configured')) }
  getCurrentUser() { return this.fail() }
  getTeam() { return this.fail() }
  getTeams() { return this.fail() }
  getLevels() { return this.fail() }
  getQuestions() { return this.fail() }
  getRepositories() { return this.fail() }
  getIssues() { return this.fail() }
  getCtfQuests() { return this.fail() }
  getNotifications() { return this.fail() }
  getAiConversation() { return this.fail() }
  getActivity() { return this.fail() }
  getTestResults() { return this.fail() }
  getTerminalLines() { return this.fail() }
  submitIssue(): Promise<SubmitResult> { return Promise.resolve(this.unavailable) }
  submitFlag(): Promise<SubmitResult> { return Promise.resolve(this.unavailable) }
  submitRepair(): Promise<SubmitResult> { return Promise.resolve(this.unavailable) }
  askAssistant(): Promise<AiMessage> { return this.fail() }
  markNotificationsRead(): Promise<void> { return Promise.resolve() }
}

export const dataProvider: DataProvider = DEMO_MODE ? new DemoProvider() : new PlaceholderProvider()
