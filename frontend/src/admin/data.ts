import type { AdminWorkspace } from './types'

const T = (s: string) => `2026-12-06T${s}:00+05:30`

export const EVENT_PRESET = {
  name: 'Fall Back',
  organizer: 'Software Development Club, VIT Bhopal University',
  date: '6 December 2026',
  durationMinutes: 180,
  offline: true,
  teamSizeMin: 4,
  teamSizeMax: 5,
}

const TEAM_NAMES = [
  'Segfault Saints',
  'Null Pointers',
  'Race Condition Royals',
  'Off By One',
  'Stack Overflow',
  'Heap Heroes',
  'Merge Conflict',
  'Kernel Panic',
  'Bit Flippers',
  'Syntax Error',
  'Terminal Velocity',
  'Semantic Versioning',
]

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Ananya', 'Vihaan', 'Isha', 'Reyansh', 'Myra', 'Arjun', 'Sara', 'Kiaan', 'Aadhya', 'Dhruv', 'Meera', 'Rohan', 'Tara']
const LAST = ['Sharma', 'Patel', 'Reddy', 'Iyer', 'Nair', 'Khan', 'Mehta', 'Joshi', 'Rao', 'Singh', 'Pillai', 'Das']

function memberName(i: number): string {
  return `${FIRST[i % FIRST.length]} ${LAST[(i * 3 + 1) % LAST.length]}`
}

function buildSeed(): AdminWorkspace {
  const teams = TEAM_NAMES.map((name, ti) => ({
    id: `team-${String(ti + 1).padStart(2, '0')}`,
    name,
    status: (ti === 11 ? 'inactive' : 'active') as 'active' | 'inactive',
    capacity: 5,
    createdAt: T(`09:0${ti % 10}`),
    joinCode: `FB${String(1000 + ti * 7).slice(0, 4)}`,
    functionalScore: 0,
    evaluationScore: 0,
    ctfBonus: 0,
    penalties: 0,
  }))

  const participants: AdminWorkspace['participants'] = []
  let pi = 0
  for (const team of teams) {
    const count = team.status === 'inactive' ? 3 : 4 + (pi % 2)
    for (let m = 0; m < count; m++) {
      const idx = pi++
      participants.push({
        id: `P-${String(idx + 1).padStart(4, '0')}`,
        name: memberName(idx),
        email: `${memberName(idx).toLowerCase().replace(' ', '.')}@vitbhopal.ac.in`,
        teamId: team.id,
        registrationStatus: 'registered',
        participationStatus: team.status === 'inactive' ? 'inactive' : 'active',
        registeredAt: T(`08:${String(10 + (idx % 45)).padStart(2, '0')}`),
        lastActiveAt: team.status === 'inactive' ? null : T(`10:${String(5 + (idx % 50)).padStart(2, '0')}`),
      })
    }
  }
  participants.push(
    {
      id: `P-${String(participants.length + 1).padStart(4, '0')}`,
      name: 'Walk In Guest',
      email: 'walkin.guest@vitbhopal.ac.in',
      teamId: null,
      registrationStatus: 'pending',
      participationStatus: 'inactive',
      registeredAt: T('10:55'),
      lastActiveAt: null,
    },
    {
      id: `P-${String(participants.length + 2).padStart(4, '0')}`,
      name: 'Reserve Candidate',
      email: 'reserve.candidate@vitbhopal.ac.in',
      teamId: null,
      registrationStatus: 'waitlisted',
      participationStatus: 'inactive',
      registeredAt: T('09:58'),
      lastActiveAt: null,
    },
  )

  const rounds: AdminWorkspace['rounds'] = [
    {
      id: 'round-1',
      name: 'Round 1: Setup and Triage',
      description: 'Application setup, baseline test run, first repairs.',
      active: true,
      durationMinutes: 60,
      instructions: 'Get the app running, reproduce each failure, fix frontend and backend defects.',
      order: 1,
      status: 'active',
    },
    {
      id: 'round-2',
      name: 'Round 2: Deep Repair and CTF',
      description: 'Core logic restoration plus optional CTF side quests.',
      active: true,
      durationMinutes: 90,
      instructions: 'Finish repairs, verify behavior, hunt hidden flags.',
      order: 2,
      status: 'draft',
    },
    {
      id: 'round-3',
      name: 'Round 3: Final Demo',
      description: 'Final testing and demonstration.',
      active: false,
      durationMinutes: 30,
      instructions: 'Demonstrate the restored application to organizers.',
      order: 3,
      status: 'draft',
    },
  ]

  const repositories: AdminWorkspace['repositories'] = [
    {
      id: 'repo-app',
      name: 'Bug Hunt app (participant codebase)',
      identifier: 'bug-hunt-app',
      url: 'https://github.com/sdc-vitbhopal/bug-hunt-app',
      roundId: 'round-1',
      evaluationId: 'eval-1',
      status: 'active',
      lastUpdated: T('09:30'),
      configuration: 'Vite + React frontend, FastAPI backend, Postgres. Seeded with planted defects.',
    },
    {
      id: 'repo-app-b',
      name: 'Bug Hunt app option B',
      identifier: 'bug-hunt-app-option-b',
      url: 'https://github.com/sdc-vitbhopal/bug-hunt-app-option-b',
      roundId: 'round-2',
      evaluationId: null,
      status: 'draft',
      lastUpdated: T('09:45'),
      configuration: 'Alternate variant of the same app with a different defect set.',
    },
  ]

  const questions: AdminWorkspace['questions'] = [
    {
      id: 'q-1',
      title: 'Restore checkout totals',
      description: 'Cart totals are wrong after applying discounts.',
      instructions: 'Find and fix the pricing bug; verify with the provided test cases.',
      expectedTask: 'Correct total calculation including discounts and tax.',
      scoringCriteria: '2 points per correct edge case, up to max.',
      maxPoints: 8,
      difficulty: 'medium',
      status: 'published',
      roundId: 'round-1',
      evaluationId: 'eval-1',
      order: 1,
    },
    {
      id: 'q-2',
      title: 'Repair broken authentication',
      description: 'Login returns 500 for valid users.',
      instructions: 'Trace the auth path and restore sign-in.',
      expectedTask: 'Valid credentials authenticate; invalid ones are rejected.',
      scoringCriteria: 'Full points if both paths work.',
      maxPoints: 6,
      difficulty: 'hard',
      status: 'published',
      roundId: 'round-1',
      evaluationId: 'eval-1',
      order: 2,
    },
    {
      id: 'q-3',
      title: 'CTF: find the hidden flag',
      description: 'A flag is hidden in the codebase or API responses.',
      instructions: 'Inspect configuration, routes and responses.',
      expectedTask: 'Submit the discovered flag.',
      scoringCriteria: 'Bonus points on discovery.',
      maxPoints: 5,
      difficulty: 'easy',
      status: 'published',
      roundId: 'round-2',
      evaluationId: null,
      order: 3,
    },
  ]

  const evaluations: AdminWorkspace['evaluations'] = [
    {
      id: 'eval-1',
      roundId: 'round-1',
      title: 'Core repair evaluation',
      description: 'Score restored frontend and backend functionality.',
      instructions: 'Run the checklist; score each criterion.',
      repositoryId: 'repo-app',
      maxScore: 60,
      bonusPoints: 5,
      criteria: [
        { id: 'c-1', name: 'Frontend restored', description: 'UI flows work', maxPoints: 20 },
        { id: 'c-2', name: 'Backend restored', description: 'API endpoints work', maxPoints: 25 },
        { id: 'c-3', name: 'Tests pass', description: 'Provided tests pass', maxPoints: 15 },
      ],
      questionIds: ['q-1', 'q-2'],
      status: 'published',
      createdAt: T('09:00'),
      updatedAt: T('09:40'),
    },
    {
      id: 'eval-2',
      roundId: 'round-2',
      title: 'CTF and hardening',
      description: 'Optional side quests and security hardening.',
      instructions: 'Award bonus for discovered flags.',
      repositoryId: 'repo-app-b',
      maxScore: 30,
      bonusPoints: 10,
      criteria: [{ id: 'c-4', name: 'Security hardening', description: 'Weaknesses closed', maxPoints: 30 }],
      questionIds: ['q-3'],
      status: 'draft',
      createdAt: T('09:50'),
      updatedAt: T('09:55'),
    },
  ]

  const scoreSeed = [
    [48, 12, 7, 0], [45, 11, 5, 2], [50, 13, 9, 0], [41, 10, 4, 3], [46, 12, 6, 0], [39, 9, 3, 1],
    [44, 11, 8, 0], [43, 10, 5, 2], [47, 12, 7, 0], [40, 10, 4, 4], [38, 9, 6, 0], [0, 0, 0, 0],
  ]
  scoreSeed.forEach((s, i) => {
    teams[i].functionalScore = s[0]
    teams[i].evaluationScore = s[1]
    teams[i].ctfBonus = s[2]
    teams[i].penalties = s[3]
  })

  const incidents: AdminWorkspace['incidents'] = [
    {
      id: 'inc-1',
      teamId: 'team-03',
      teamName: 'Race Condition Royals',
      participantId: participants.find((p) => p.teamId === 'team-03')?.id ?? null,
      participantName: participants.find((p) => p.teamId === 'team-03')?.name ?? null,
      type: 'ctrl_v',
      timestamp: T('10:14'),
      roundId: 'round-1',
      roundName: 'Round 1: Setup and Triage',
      severity: 'medium',
      status: 'new',
      events: [
        { id: 'ie-1', timestamp: T('10:14'), kind: 'clipboard_paste', detail: 'Ctrl+V recorded in workspace editor.' },
        { id: 'ie-2', timestamp: T('10:14'), kind: 'clipboard_paste', detail: 'Second paste within 2 seconds.' },
      ],
      notes: [],
      warningIssued: false,
      penaltyApplied: false,
    },
    {
      id: 'inc-2',
      teamId: 'team-05',
      teamName: 'Stack Overflow',
      participantId: participants.find((p) => p.teamId === 'team-05')?.id ?? null,
      participantName: participants.find((p) => p.teamId === 'team-05')?.name ?? null,
      type: 'ctrl_shift_i',
      timestamp: T('10:21'),
      roundId: 'round-1',
      roundName: 'Round 1: Setup and Triage',
      severity: 'low',
      status: 'under_review',
      events: [{ id: 'ie-3', timestamp: T('10:21'), kind: 'devtools_open', detail: 'Ctrl+Shift+I recorded.' }],
      notes: [{ id: 'in-1', timestamp: T('10:25'), admin: 'organizer', body: 'Checking whether devtools use is benign.' }],
      warningIssued: false,
      penaltyApplied: false,
    },
    {
      id: 'inc-3',
      teamId: 'team-08',
      teamName: 'Kernel Panic',
      participantId: participants.find((p) => p.teamId === 'team-08')?.id ?? null,
      participantName: participants.find((p) => p.teamId === 'team-08')?.name ?? null,
      type: 'repeated_suspicious_activity',
      timestamp: T('10:33'),
      roundId: 'round-1',
      roundName: 'Round 1: Setup and Triage',
      severity: 'high',
      status: 'new',
      events: [
        { id: 'ie-4', timestamp: T('10:31'), kind: 'clipboard_copy', detail: 'Ctrl+C recorded.' },
        { id: 'ie-5', timestamp: T('10:32'), kind: 'clipboard_paste', detail: 'Ctrl+V recorded.' },
        { id: 'ie-6', timestamp: T('10:33'), kind: 'devtools_open', detail: 'Ctrl+Shift+I recorded.' },
      ],
      notes: [],
      warningIssued: false,
      penaltyApplied: false,
    },
  ]

  const admins: AdminWorkspace['admins'] = [
    { id: 'adm-1', name: 'Event Director', email: 'director@sdc.vitbhopal.ac.in', role: 'super_admin', status: 'active', createdAt: T('06:00'), lastLoginAt: T('10:00'), resetRequired: false },
    { id: 'adm-2', name: 'Kalpesh Parashar', email: 'kalpesh@sdc.vitbhopal.ac.in', role: 'admin', status: 'active', createdAt: T('06:00'), lastLoginAt: T('09:55'), resetRequired: false },
    { id: 'adm-3', name: 'Aashish Prasad', email: 'aashish@sdc.vitbhopal.ac.in', role: 'organizer', status: 'active', createdAt: T('06:00'), lastLoginAt: T('09:50'), resetRequired: false },
    { id: 'adm-4', name: 'Dr. Praveen Lalwani', email: 'praveen@vitbhopal.ac.in', role: 'viewer', status: 'active', createdAt: T('06:00'), lastLoginAt: null, resetRequired: false },
  ]

  const notifications: AdminWorkspace['notifications'] = [
    { id: 'n-1', timestamp: T('10:33'), kind: 'malpractice', severity: 'warning', title: 'Malpractice alert: repeated suspicious activity', body: 'Kernel Panic triggered 3 suspicious events in 2 minutes.', read: false, link: '/admin/malpractice' },
    { id: 'n-2', timestamp: T('10:14'), kind: 'malpractice', severity: 'warning', title: 'Clipboard paste flagged', body: 'Race Condition Royals: Ctrl+V recorded.', read: false, link: '/admin/malpractice' },
    { id: 'n-3', timestamp: T('10:18'), kind: 'submission', severity: 'info', title: 'Evaluation submitted', body: 'Stack Overflow submitted Round 1 evaluation.', read: true, link: '/admin/evaluations' },
    { id: 'n-4', timestamp: T('10:05'), kind: 'flag', severity: 'info', title: 'Flag discovered', body: 'Heap Heroes discovered a CTF flag.', read: true, link: '/admin/scoreboard' },
    { id: 'n-5', timestamp: T('09:45'), kind: 'round_change', severity: 'info', title: 'Round status change', body: 'Round 1 moved to active.', read: true, link: '/admin/event-config' },
  ]

  const activity: AdminWorkspace['activity'] = [
    { id: 'a-1', timestamp: T('10:25'), admin: 'organizer', action: 'incident.review', targetType: 'incident', targetId: 'inc-2', targetLabel: 'Stack Overflow Ctrl+Shift+I', previousValue: 'new', newValue: 'under_review' },
    { id: 'a-2', timestamp: T('10:05'), admin: 'system', action: 'flag.discovered', targetType: 'team', targetId: 'team-07', targetLabel: 'Heap Heroes', previousValue: null, newValue: 'ctfBonus +1' },
    { id: 'a-3', timestamp: T('09:45'), admin: 'organizer', action: 'round.activate', targetType: 'round', targetId: 'round-1', targetLabel: 'Round 1: Setup and Triage', previousValue: 'draft', newValue: 'active' },
    { id: 'a-4', timestamp: T('09:30'), admin: 'director', action: 'event.status', targetType: 'event', targetId: 'event', targetLabel: 'Fall Back', previousValue: 'Registration Open', newValue: 'Live' },
  ]

  const permissions: AdminWorkspace['permissions'] = [
    { permission: 'event.configure', description: 'Change event-wide settings and rounds', roles: { super_admin: true, admin: true, organizer: false, viewer: false } },
    { permission: 'participants.manage', description: 'Add, edit, disable participants; CSV import', roles: { super_admin: true, admin: true, organizer: true, viewer: false } },
    { permission: 'teams.manage', description: 'Create teams, assign members', roles: { super_admin: true, admin: true, organizer: true, viewer: false } },
    { permission: 'evaluations.manage', description: 'Create rounds, evaluations, questions, repositories', roles: { super_admin: true, admin: true, organizer: true, viewer: false } },
    { permission: 'scoring.adjust', description: 'Manual score adjustments', roles: { super_admin: true, admin: true, organizer: false, viewer: false } },
    { permission: 'malpractice.review', description: 'Review incidents, issue warnings, apply penalties', roles: { super_admin: true, admin: true, organizer: true, viewer: false } },
    { permission: 'infrastructure.view', description: 'View server monitoring', roles: { super_admin: true, admin: true, organizer: true, viewer: true } },
    { permission: 'admins.manage', description: 'Manage admin accounts and permissions', roles: { super_admin: true, admin: false, organizer: false, viewer: false } },
    { permission: 'audit.view', description: 'View activity and audit logs', roles: { super_admin: true, admin: true, organizer: true, viewer: true } },
  ]

  const services: AdminWorkspace['services'] = [
    { id: 'svc-api', name: 'Backend API', status: 'Operational', detail: 'FastAPI service' },
    { id: 'svc-db', name: 'Database', status: 'Operational', detail: 'Postgres app schema' },
    { id: 'svc-gt', name: 'Ground-truth store', status: 'Operational', detail: 'Isolated gt schema' },
    { id: 'svc-queue', name: 'Job queue', status: 'Operational', detail: 'Worker queue' },
    { id: 'svc-worker', name: 'Worker', status: 'Operational', detail: 'Background scoring jobs' },
    { id: 'svc-runner', name: 'Code execution', status: 'Offline', detail: 'Disabled by design in this deployment' },
    { id: 'svc-realtime', name: 'Realtime feed', status: 'Operational', detail: 'Polling every 5s' },
  ]

  const infraSamples: AdminWorkspace['infraSamples'] = Array.from({ length: 30 }, (_, i) => {
    const minute = 5 + i
    const base = 28 + Math.sin(i / 3) * 8
    return {
      t: `10:${String(minute % 60).padStart(2, '0')}`,
      cpu: Math.round(base + (i % 5)),
      ram: Math.round(54 + Math.sin(i / 4) * 6),
      disk: 41,
      networkIn: Math.round(120 + Math.sin(i / 2) * 40),
      networkOut: Math.round(80 + Math.cos(i / 2) * 30),
      load: Math.round((base / 100) * 4 * 100) / 100,
      connections: Math.round(40 + Math.sin(i / 3) * 12),
      apiResponseMs: Math.round(120 + Math.sin(i / 2) * 35),
      errorRate: Math.round((0.4 + Math.sin(i / 5) * 0.3) * 100) / 100,
    }
  })

  return {
    event: {
      eventName: EVENT_PRESET.name,
      organizer: EVENT_PRESET.organizer,
      eventStatus: 'Live',
      currentRoundId: 'round-1',
      timezone: 'Asia/Kolkata',
      registrationOpen: true,
      maxParticipants: 60,
      maxTeams: 12,
      teamSizeMin: EVENT_PRESET.teamSizeMin,
      teamSizeMax: EVENT_PRESET.teamSizeMax,
      scoringNotes: 'Functional repair is primary. CTF bonus is separate and never outweighs repair score.',
    },
    participants,
    teams,
    rounds,
    evaluations,
    questions,
    repositories,
    adjustments: [
      {
        id: 'adj-1',
        teamId: 'team-09',
        teamName: 'Bit Flippers',
        amount: -4,
        reason: 'Duplicate submission counted twice.',
        category: 'scoring_error',
        adminIdentity: 'director',
        timestamp: T('10:28'),
        previousScore: 71,
        updatedScore: 67,
        incidentId: null,
      },
    ],
    incidents,
    admins,
    loginAttempts: [
      { id: 'la-1', timestamp: T('10:00'), email: 'director@sdc.vitbhopal.ac.in', success: true, reason: 'ok' },
      { id: 'la-2', timestamp: T('09:59'), email: 'unknown@example.com', success: false, reason: 'invalid credentials' },
      { id: 'la-3', timestamp: T('09:55'), email: 'kalpesh@sdc.vitbhopal.ac.in', success: true, reason: 'ok' },
    ],
    sessions: [
      { id: 'sess-1', adminId: 'adm-1', adminName: 'Event Director', createdAt: T('10:00'), lastSeenAt: T('10:30'), revoked: false },
      { id: 'sess-2', adminId: 'adm-2', adminName: 'Kalpesh Parashar', createdAt: T('09:55'), lastSeenAt: T('10:20'), revoked: false },
    ],
    activity,
    notifications,
    permissions,
    services,
    infraSamples,
    recentIncidents: [
      { id: 'ri-1', timestamp: T('10:33'), service: 'Job queue', status: 'Degraded', detail: 'Oldest queued job age rose briefly.' },
      { id: 'ri-2', timestamp: T('09:12'), service: 'Backend API', status: 'Operational', detail: 'Elevated latency resolved.' },
    ],
  }
}

export function seedWorkspace(): AdminWorkspace {
  return buildSeed()
}
