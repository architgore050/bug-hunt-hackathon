import type { Participant } from '../types'

/** Sample roster for the signed-in team. Replace with the real roster provider. */
export const currentUser: Participant = {
  id: 'u-1024',
  name: 'Tathagato Roy',
  handle: 'troy',
  role: 'Team lead',
  initials: 'TR',
}

export const teammates: Participant[] = [
  currentUser,
  { id: 'u-1025', name: 'Ananya Mehta', handle: 'amehta', role: 'Backend', initials: 'AM' },
  { id: 'u-1026', name: 'Rohan Kulkarni', handle: 'rkulkarni', role: 'Frontend', initials: 'RK' },
  { id: 'u-1027', name: 'Sneha Iyer', handle: 'siyer', role: 'Security', initials: 'SI' },
  { id: 'u-1028', name: 'Dev Pratap Singh', handle: 'dpsingh', role: 'QA', initials: 'DS' },
]
