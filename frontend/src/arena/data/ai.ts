import type { AiMessage, Activity, TestResult } from '../types'

export const aiConversation: AiMessage[] = [
  {
    id: 'AI-1', role: 'user',
    text: 'Why does the vote counter lose increments when two requests arrive together?',
    context: 'server/routes/notes.js, lines 14 to 22',
  },
  {
    id: 'AI-2', role: 'assistant',
    text: 'The handler reads note.votes into a local variable, then writes current + 1 later inside a timer. Two requests can read the same value before either write happens, so both writes produce the same result. Move the read and write into one atomic operation and avoid deferring the mutation.',
  },
  {
    id: 'AI-3', role: 'user',
    text: 'Can you suggest a minimal fix that keeps the response shape?',
    context: 'server/routes/notes.js',
  },
  {
    id: 'AI-4', role: 'assistant',
    text: 'Increment directly on the stored object in the same tick, persist it, then return the new value. For example replace the timer block with note.votes += 1 followed by db.save(), and respond with { votes: note.votes }. If requests are spread across processes, use a database level atomic update instead.',
  },
]

export const aiSuggestions = [
  'Explain selected code',
  'Help debug a failing test',
  'Analyse this function',
  'Suggest a minimal fix',
]

export const testResults: TestResult[] = [
  { name: 'auth rejects mismatched token', status: 'fail', detail: 'Expected 403, received 200' },
  { name: 'totals apply quantity', status: 'fail', detail: 'Expected 240, received 120' },
  { name: 'vote increments once', status: 'pass', detail: 'Completed in 12 ms' },
  { name: 'note list escapes markup', status: 'pass', detail: 'Completed in 8 ms' },
  { name: 'health endpoint responds', status: 'pass', detail: 'Completed in 4 ms' },
]

export const activityFeed: Activity[] = [
  { id: 'A-01', type: 'issue', actor: 'Ananya Mehta', text: 'submitted an issue on auth middleware', time: '11 minutes ago' },
  { id: 'A-02', type: 'score', actor: 'System', text: 'awarded 28 points for issue ISS-1045', time: '18 minutes ago' },
  { id: 'A-03', type: 'flag', actor: 'Sneha Iyer', text: 'found the Forgotten Header flag', time: '32 minutes ago' },
  { id: 'A-04', type: 'repair', actor: 'Rohan Kulkarni', text: 'saved a repair to totals.js', time: '41 minutes ago' },
  { id: 'A-05', type: 'task', actor: 'Tathagato Roy', text: 'completed repair task Q-L3-02', time: '55 minutes ago' },
  { id: 'A-06', type: 'score', actor: 'System', text: 'ranked the team at position 2', time: '1 hour ago' },
]

export const terminalLines = [
  '$ npm test',
  '> papyrus@1.4.2 test',
  '> node --test',
  '',
  'TAP version 13',
  '# Subtest: auth rejects mismatched token',
  'not ok 1 - auth rejects mismatched token',
  '  expected: 403',
  '  actual:   200',
  '# Subtest: vote increments once',
  'ok 2 - vote increments once',
  '# tests 5',
  '# pass 3',
  '# fail 2',
]
