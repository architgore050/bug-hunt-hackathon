import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AI_NOTICE, LEVEL_POLICY } from '../config'
import { dataProvider, type IssueDraft, type SubmitResult } from '../services'
import type {
  Activity, AiMessage, CtfQuest, Issue, Level, NotificationItem, Participant,
  Question, Repository, Team, TestResult,
} from '../types'

type Tone = 'info' | 'ok' | 'warn' | 'danger'

interface Toast {
  id: number
  message: string
  tone: Tone
}

interface ArenaValue {
  loading: boolean
  isDemo: boolean
  user: Participant | null
  team: Team | null
  teams: Team[]
  levels: Level[]
  questions: Question[]
  repositories: Record<string, Repository>
  issues: Issue[]
  quests: CtfQuest[]
  notices: NotificationItem[]
  messages: AiMessage[]
  activity: Activity[]
  testResults: TestResult[]
  terminalLines: string[]
  currentLevel: number
  levelPolicy: (typeof LEVEL_POLICY)[number]
  pendingLevel: number | null
  requestLevel: (level: number) => void
  confirmLevel: () => void
  cancelLevel: () => void
  submitIssue: (draft: IssueDraft) => Promise<SubmitResult>
  submitFlag: (questId: string, value: string) => Promise<SubmitResult>
  submitRepair: (summary: string) => Promise<SubmitResult>
  askAssistant: (prompt: string, context?: string) => Promise<void>
  notificationsOpen: boolean
  setNotificationsOpen: (open: boolean) => void
  markAllRead: () => void
  markRead: (id: string) => void
  unreadCount: number
  toasts: Toast[]
  pushToast: (message: string, tone?: Tone) => void
  dismissToast: (id: number) => void
  restrictionNotice: string | null
  warnRestriction: (label: string) => void
  clearRestrictionNotice: () => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
}

const ArenaContext = createContext<ArenaValue | null>(null)

export function ArenaProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<Participant | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [levels, setLevels] = useState<Level[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [repositories, setRepositories] = useState<Record<string, Repository>>({})
  const [issues, setIssues] = useState<Issue[]>([])
  const [quests, setQuests] = useState<CtfQuest[]>([])
  const [notices, setNotices] = useState<NotificationItem[]>([])
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [terminalLines, setTerminalLines] = useState<string[]>([])

  const [currentLevel, setCurrentLevel] = useState(3)
  const [pendingLevel, setPendingLevel] = useState<number | null>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [restrictionNotice, setRestrictionNotice] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      const [
        nextUser, nextTeam, nextTeams, nextLevels, nextQuestions, nextRepos,
        nextIssues, nextQuests, nextNotices, nextMessages, nextActivity,
        nextTests, nextTerminal,
      ] = await Promise.all([
        dataProvider.getCurrentUser(), dataProvider.getTeam(), dataProvider.getTeams(),
        dataProvider.getLevels(), dataProvider.getQuestions(), dataProvider.getRepositories(),
        dataProvider.getIssues(), dataProvider.getCtfQuests(), dataProvider.getNotifications(),
        dataProvider.getAiConversation(), dataProvider.getActivity(), dataProvider.getTestResults(),
        dataProvider.getTerminalLines(),
      ])
      if (!active) return
      setUser(nextUser); setTeam(nextTeam); setTeams(nextTeams); setLevels(nextLevels)
      setQuestions(nextQuestions); setRepositories(nextRepos); setIssues(nextIssues)
      setQuests(nextQuests); setNotices(nextNotices); setMessages(nextMessages)
      setActivity(nextActivity); setTestResults(nextTests); setTerminalLines(nextTerminal)
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [])

  const pushToast = useCallback((message: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, tone }])
    window.setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), 4200)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const requestLevel = useCallback((level: number) => {
    if (level === currentLevel) return
    if (level === 4) {
      setPendingLevel(4)
      return
    }
    setCurrentLevel(level)
    pushToast(`Level ${level} workspace loaded`)
  }, [currentLevel, pushToast])

  const confirmLevel = useCallback(() => {
    if (pendingLevel !== null) {
      setCurrentLevel(pendingLevel)
      pushToast(AI_NOTICE, 'warn')
    }
    setPendingLevel(null)
  }, [pendingLevel, pushToast])

  const cancelLevel = useCallback(() => setPendingLevel(null), [])

  const refreshIssues = useCallback(async () => {
    setIssues(await dataProvider.getIssues())
  }, [])

  const refreshQuests = useCallback(async () => {
    setQuests(await dataProvider.getCtfQuests())
  }, [])

  const submitIssue = useCallback(async (draft: IssueDraft) => {
    const result = await dataProvider.submitIssue(draft)
    if (result.ok) await refreshIssues()
    return result
  }, [refreshIssues])

  const submitFlag = useCallback(async (questId: string, value: string) => {
    const result = await dataProvider.submitFlag(questId, value)
    if (result.ok) await refreshQuests()
    return result
  }, [refreshQuests])

  const submitRepair = useCallback((summary: string) => dataProvider.submitRepair(summary), [])

  const askAssistant = useCallback(async (prompt: string, context?: string) => {
    const userMessage: AiMessage = { id: `U-${Date.now()}`, role: 'user', text: prompt, context }
    setMessages((prev) => [...prev, userMessage])
    const reply = await dataProvider.askAssistant(prompt, context)
    setMessages((prev) => [...prev, reply])
  }, [])

  const markAllRead = useCallback(() => {
    setNotices((prev) => prev.map((notice) => ({ ...notice, read: true })))
    void dataProvider.markNotificationsRead(notices.map((notice) => notice.id))
  }, [notices])

  const markRead = useCallback((id: string) => {
    setNotices((prev) => prev.map((notice) => notice.id === id ? { ...notice, read: true } : notice))
    void dataProvider.markNotificationsRead([id])
  }, [])

  const warnRestriction = useCallback((label: string) => {
    setRestrictionNotice(`${label} is restricted by event policy`)
    window.setTimeout(() => setRestrictionNotice(null), 2600)
  }, [])

  const clearRestrictionNotice = useCallback(() => setRestrictionNotice(null), [])

  const unreadCount = notices.filter((notice) => !notice.read).length
  const levelPolicy = LEVEL_POLICY[currentLevel]

  const value = useMemo<ArenaValue>(() => ({
    loading, isDemo: dataProvider.isDemo, user, team, teams, levels, questions,
    repositories, issues, quests, notices, messages, activity, testResults, terminalLines,
    currentLevel, levelPolicy, pendingLevel, requestLevel, confirmLevel, cancelLevel,
    submitIssue, submitFlag, submitRepair, askAssistant,
    notificationsOpen, setNotificationsOpen, markAllRead, markRead, unreadCount,
    toasts, pushToast, dismissToast,
    restrictionNotice, warnRestriction, clearRestrictionNotice,
    sidebarCollapsed, setSidebarCollapsed,
  }), [
    loading, user, team, teams, levels, questions, repositories, issues, quests, notices,
    messages, activity, testResults, terminalLines, currentLevel, levelPolicy, pendingLevel,
    requestLevel, confirmLevel, cancelLevel, submitIssue, submitFlag, submitRepair,
    askAssistant, notificationsOpen, markAllRead, markRead, unreadCount, toasts,
    pushToast, dismissToast, restrictionNotice, warnRestriction, clearRestrictionNotice,
    sidebarCollapsed,
  ])

  return <ArenaContext.Provider value={value}>{children}</ArenaContext.Provider>
}

export function useArena(): ArenaValue {
  const context = useContext(ArenaContext)
  if (!context) throw new Error('useArena must be used inside ArenaProvider')
  return context
}
