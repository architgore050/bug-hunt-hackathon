import type { Level } from '../types'

/** Illustrative level progress for the signed-in team. */
export const levels: Level[] = [
  {
    number: 1, name: 'Reconnaissance', slug: 'recon', state: 'completed',
    tagline: 'Find the faults',
    description: 'Inspect the assigned repository and submit evidence backed bug reports.',
    objective: 'Identify legitimate issues and document them with file and line evidence.',
    expectedActions: ['Inspect the repository', 'File reports with evidence', 'Track review status'],
    restrictions: ['No AI assistance', 'Copy and paste restricted', 'Developer tools restricted'],
    aiAllowed: false,
    tasksCompleted: 6, tasksTotal: 6, issuesSubmitted: 6, issuesAccepted: 4,
    repairsCompleted: 0, flagsFound: 1, pointsEarned: 168,
  },
  {
    number: 2, name: 'Deep Inspection', slug: 'deep', state: 'completed',
    tagline: 'Go deeper',
    description: 'Answer admin configured prompts and uncover the harder defects.',
    objective: 'Resolve deeper analysis prompts using the same evidence workflow.',
    expectedActions: ['Read each prompt', 'Reference exact code locations', 'Submit findings'],
    restrictions: ['No AI assistance', 'Copy and paste restricted', 'Developer tools restricted'],
    aiAllowed: false,
    tasksCompleted: 5, tasksTotal: 5, issuesSubmitted: 6, issuesAccepted: 5,
    repairsCompleted: 0, flagsFound: 1, pointsEarned: 188,
  },
  {
    number: 3, name: 'Repair', slug: 'repair', state: 'active',
    tagline: 'Restore function',
    description: 'Repair assigned defects inside the integrated workspace with AI assistance.',
    objective: 'Apply fixes and keep the evaluation suite green.',
    expectedActions: ['Fix assigned defects', 'Run the test suite', 'Submit the repair'],
    restrictions: ['AI assistance enabled', 'Clipboard follows event policy'],
    aiAllowed: true,
    tasksCompleted: 2, tasksTotal: 4, issuesSubmitted: 0, issuesAccepted: 0,
    repairsCompleted: 2, flagsFound: 0, pointsEarned: 196,
  },
  {
    number: 4, name: 'Final Challenge', slug: 'final', state: 'locked',
    tagline: 'Work alone',
    description: 'A new repository, no AI assistance, and a clean room finish.',
    objective: 'Repair the final repository independently under restricted rules.',
    expectedActions: ['Inspect the new repository', 'Repair without AI', 'Submit the final build'],
    restrictions: ['AI assistance disabled', 'Copy and paste restricted', 'Developer tools restricted'],
    aiAllowed: false,
    tasksCompleted: 0, tasksTotal: 3, issuesSubmitted: 0, issuesAccepted: 0,
    repairsCompleted: 0, flagsFound: 0, pointsEarned: 0,
  },
]

export const activeLevelNumber = 3
