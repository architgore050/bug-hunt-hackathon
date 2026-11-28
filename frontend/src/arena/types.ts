export type LevelState = 'completed' | 'active' | 'upcoming' | 'locked'
export type IssueStatus = 'draft' | 'submitted' | 'under-review' | 'accepted' | 'rejected' | 'duplicate'
export type Movement = 'up' | 'down' | 'flat'
export type Language = 'javascript' | 'python' | 'json' | 'css' | 'html' | 'markdown' | 'text'

export interface Participant {
  id: string
  name: string
  handle: string
  role: string
  initials: string
}

export interface ScoreBreakdown {
  bugIdentification: number
  acceptedIssues: number
  repair: number
  evaluation: number
  ctfBonus: number
  penalties: number
}

export interface Team {
  id: string
  name: string
  initials: string
  rank: number
  score: number
  level: number
  movement: Movement
  acceptedIssues: number
  repairPoints: number
  ctfBonus: number
  breakdown: ScoreBreakdown
  members: Participant[]
}

export interface Level {
  number: number
  name: string
  slug: string
  state: LevelState
  tagline: string
  description: string
  objective: string
  expectedActions: string[]
  restrictions: string[]
  aiAllowed: boolean
  tasksCompleted: number
  tasksTotal: number
  issuesSubmitted: number
  issuesAccepted: number
  repairsCompleted: number
  flagsFound: number
  pointsEarned: number
}

export interface Question {
  id: string
  level: number
  title: string
  prompt: string
  requirement: string
  points: number
  status: 'sample' | 'answered' | 'under-review'
  targetHint: string
  answer?: string
}

export interface RepoFile {
  path: string
  language: Language
  content: string
  modified?: boolean
}

export interface RepoTreeFolder {
  type: 'folder'
  name: string
  path: string
  children: RepoTreeNode[]
}

export interface RepoTreeFile {
  type: 'file'
  name: string
  path: string
  language: Language
  modified?: boolean
}

export type RepoTreeNode = RepoTreeFolder | RepoTreeFile

export interface Repository {
  id: string
  name: string
  description: string
  assignedLevel: string
  tags: string[]
  branch: string
  files: RepoFile[]
  tree: RepoTreeNode[]
  recentPaths: string[]
}

export interface Issue {
  id: string
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
  status: IssueStatus
  points: number
  submittedAt: string
  feedback?: string
}

export interface CtfQuest {
  id: string
  name: string
  category: string
  difficulty: 'Easy' | 'Medium' | 'Hard'
  points: number
  hintAvailable: boolean
  hint: string
  description: string
  completed: boolean
}

export interface NotificationItem {
  id: string
  kind: 'level' | 'question' | 'repo' | 'issue' | 'score' | 'flag' | 'rank' | 'announcement' | 'time'
  title: string
  body: string
  time: string
  read: boolean
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  context?: string
}

export interface Activity {
  id: string
  type: 'issue' | 'task' | 'flag' | 'repair' | 'score'
  actor: string
  text: string
  time: string
}

export interface TestResult {
  name: string
  status: 'pass' | 'fail' | 'skip'
  detail: string
}

export interface SubmissionRecord {
  id: string
  title: string
  kind: 'issue' | 'repair' | 'flag'
  level: number
  status: string
  time: string
  points: number
}
