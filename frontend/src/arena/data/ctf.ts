import type { CtfQuest } from '../types'

/** Bonus side quests. Flag values are intentionally never included. */
export const ctfQuests: CtfQuest[] = [
  {
    id: 'CTF-01', name: 'The Forgotten Header', category: 'Code analysis', difficulty: 'Easy', points: 20,
    hintAvailable: true,
    hint: 'Look at what the route guard reads before it decides who you are.',
    description: 'A header is trusted without verification. Trace where it is consumed and infer the token shape that would satisfy the guard.',
    completed: true,
  },
  {
    id: 'CTF-02', name: 'Config with a Memory', category: 'Configuration review', difficulty: 'Easy', points: 20,
    hintAvailable: true,
    hint: 'The value is in a JSON file that ships with the service.',
    description: 'A credential was left in a committed configuration file. Identify the key that stores it.',
    completed: true,
  },
  {
    id: 'CTF-03', name: 'Endpoint Not Listed', category: 'API auditing', difficulty: 'Medium', points: 30,
    hintAvailable: true,
    hint: 'The route table has more than the client uses. Try enumerating method and path pairs.',
    description: 'An undocumented route returns a small secret when called with the right method.',
    completed: false,
  },
  {
    id: 'CTF-04', name: 'Token in the Wild', category: 'Hidden token discovery', difficulty: 'Hard', points: 30,
    hintAvailable: false,
    hint: '',
    description: 'A generated token survives in a build artefact. Find the artefact and recover the marker.',
    completed: false,
  },
]
