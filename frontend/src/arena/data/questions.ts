import type { Question } from '../types'

/**
 * Illustrative prompts. These are clearly marked as sample data in the UI.
 * Real competition questions are supplied by the admin configured provider.
 */
export const questions: Question[] = [
  {
    id: 'Q-L1-01', level: 1, title: 'Authentication bypass in route guard',
    prompt: 'The notes API exposes a route that returns another user data. Locate the middleware responsible and describe the exact failure.',
    requirement: 'Reference the middleware file and the line where the identity check is skipped.',
    points: 24, status: 'answered', targetHint: 'server/middleware/auth.js',
    answer: 'The guard only checks that an Authorization header exists and never verifies the token signature or matches it to the requested user id.',
  },
  {
    id: 'Q-L1-02', level: 1, title: 'Incorrect total calculation',
    prompt: 'A report shows the wrong grand total for a list of items. Identify the computation error.',
    requirement: 'Point to the reduce callback and explain the accumulator mistake.',
    points: 18, status: 'answered', targetHint: 'server/utils/totals.js',
  },
  {
    id: 'Q-L2-01', level: 2, title: 'Concurrency flaw in counter update',
    prompt: 'Under parallel requests the vote counter loses increments. Explain the read modify write hazard.',
    requirement: 'Name the function and describe why the update is not atomic.',
    points: 32, status: 'answered', targetHint: 'server/routes/notes.js',
  },
  {
    id: 'Q-L2-02', level: 2, title: 'Unescaped content in rendered list',
    prompt: 'A crafted note title executes script in the browser. Trace the render path that allows this.',
    requirement: 'Identify the component and the property that injects raw markup.',
    points: 28, status: 'under-review', targetHint: 'src/components/NoteList.jsx',
  },
  {
    id: 'Q-L2-03', level: 2, title: 'Leaked credential in committed config',
    prompt: 'A secret appears in a file that ships with the application. Find it without revealing the value.',
    requirement: 'Reference the config file and line, and explain the exposure path.',
    points: 22, status: 'sample', targetHint: 'config/default.json',
  },
  {
    id: 'Q-L3-01', level: 3, title: 'Repair authentication bypass',
    prompt: 'Restore correct identity verification in the route guard and keep existing behaviour intact.',
    requirement: 'The evaluation suite checks that mismatched tokens are rejected.',
    points: 90, status: 'sample', targetHint: 'server/middleware/auth.js',
  },
  {
    id: 'Q-L3-02', level: 3, title: 'Repair total calculation',
    prompt: 'Fix the accumulator so totals match the expected sums for mixed item lists.',
    requirement: 'Do not change the public function signature.',
    points: 70, status: 'sample', targetHint: 'server/utils/totals.js',
  },
]
