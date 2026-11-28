import type { Participant, ScoreBreakdown, Team } from '../types'
import { teammates } from './participants'

const breakdown = (
  bugIdentification: number,
  acceptedIssues: number,
  repair: number,
  evaluation: number,
  ctfBonus: number,
  penalties = 0,
): ScoreBreakdown => ({ bugIdentification, acceptedIssues, repair, evaluation, ctfBonus, penalties })

const member = (name: string, handle: string, role: string, initials: string): Participant => ({
  id: `u-${handle}`,
  name,
  handle,
  role,
  initials,
})

export const ownTeamId = 'TB-2417'

/**
 * Illustrative leaderboard. Scores and movement are sample values only and
 * must never be presented as real results while DEMO_MODE is enabled.
 */
export const teams: Team[] = [
  {
    id: 'TB-2204', name: 'Null Pointer Syndicate', initials: 'NP', rank: 1, score: 742, level: 3,
    movement: 'up', acceptedIssues: 14, repairPoints: 410, ctfBonus: 60,
    breakdown: breakdown(96, 196, 410, 80, 60),
    members: [member('Kabir Shah', 'kabir', 'Lead', 'KS'), member('Ira Nair', 'ira', 'Backend', 'IN'), member('Om Joshi', 'om', 'Frontend', 'OJ'), member('Lea Thomas', 'lea', 'Security', 'LT')],
  },
  {
    id: 'TB-2417', name: 'Stack Trace Collective', initials: 'ST', rank: 2, score: 688, level: 3,
    movement: 'up', acceptedIssues: 12, repairPoints: 372, ctfBonus: 80,
    breakdown: breakdown(84, 168, 372, 84, 80),
    members: teammates,
  },
  {
    id: 'TB-1189', name: 'Segfault Society', initials: 'SF', rank: 3, score: 651, level: 3,
    movement: 'down', acceptedIssues: 13, repairPoints: 330, ctfBonus: 40,
    breakdown: breakdown(92, 182, 330, 67, 40),
    members: [member('Nikhil Rao', 'nikhil', 'Lead', 'NR'), member('Priya Das', 'priya', 'Backend', 'PD'), member('Arjun Menon', 'arjun', 'Frontend', 'AM'), member('Zoya Khan', 'zoya', 'QA', 'ZK')],
  },
  {
    id: 'TB-3301', name: 'Off By One', initials: 'OB', rank: 4, score: 594, level: 2,
    movement: 'flat', acceptedIssues: 11, repairPoints: 240, ctfBonus: 100,
    breakdown: breakdown(78, 154, 240, 22, 100),
    members: [member('Yash Gupta', 'yash', 'Lead', 'YG'), member('Mira Sen', 'mira', 'Security', 'MS'), member('Ravi Teja', 'ravi', 'Backend', 'RT'), member('Elsa George', 'elsa', 'QA', 'EG')],
  },
  {
    id: 'TB-1902', name: 'Heap Overflow Hotel', initials: 'HO', rank: 5, score: 537, level: 2,
    movement: 'up', acceptedIssues: 9, repairPoints: 210, ctfBonus: 60,
    breakdown: breakdown(70, 126, 210, 71, 60),
    members: [member('Aditya Verma', 'aditya', 'Lead', 'AV'), member('Sara Ali', 'sara', 'Frontend', 'SA'), member('Vivek Nair', 'vivek', 'Backend', 'VN')],
  },
  {
    id: 'TB-2756', name: 'Race Condition RC', initials: 'RC', rank: 6, score: 498, level: 2,
    movement: 'down', acceptedIssues: 10, repairPoints: 170, ctfBonus: 40,
    breakdown: breakdown(74, 140, 170, 74, 40),
    members: [member('Manav Jain', 'manav', 'Lead', 'MJ'), member('Tara Bose', 'tara', 'Backend', 'TB'), member('Jai Patel', 'jai', 'QA', 'JP'), member('Rhea Kapoor', 'rhea', 'Security', 'RK')],
  },
  {
    id: 'TB-4088', name: 'Binary Search Party', initials: 'BS', rank: 7, score: 431, level: 1,
    movement: 'flat', acceptedIssues: 8, repairPoints: 0, ctfBonus: 40,
    breakdown: breakdown(64, 112, 0, 215, 40),
    members: [member('Siddharth Roy', 'siddharth', 'Lead', 'SR'), member('Anika Sharma', 'anika', 'Frontend', 'AS'), member('Deepak Yadav', 'deepak', 'Backend', 'DY')],
  },
  {
    id: 'TB-3120', name: 'Cache Miss Club', initials: 'CM', rank: 8, score: 386, level: 1,
    movement: 'up', acceptedIssues: 7, repairPoints: 0, ctfBonus: 20,
    breakdown: breakdown(56, 98, 0, 212, 20),
    members: [member('Ritwik Banerjee', 'ritwik', 'Lead', 'RB'), member('Nandini Rao', 'nandini', 'Security', 'NR'), member('Harsh Lodha', 'harsh', 'Frontend', 'HL')],
  },
  {
    id: 'TB-1765', name: 'Undefined Behavior', initials: 'UB', rank: 9, score: 319, level: 1,
    movement: 'down', acceptedIssues: 5, repairPoints: 0, ctfBonus: 0,
    breakdown: breakdown(44, 70, 0, 205, 0),
    members: [member('Lakshya Jain', 'lakshya', 'Lead', 'LJ'), member('Meera Iyer', 'meera', 'Backend', 'MI'), member('Gautam Singh', 'gautam', 'QA', 'GS')],
  },
  {
    id: 'TB-4502', name: 'Infinite Loop Crew', initials: 'IL', rank: 10, score: 264, level: 1,
    movement: 'flat', acceptedIssues: 4, repairPoints: 0, ctfBonus: 0,
    breakdown: breakdown(34, 56, 0, 186, 0, -12),
    members: [member('Avni Desai', 'avni', 'Lead', 'AD'), member('Parth Shah', 'parth', 'Frontend', 'PS'), member('Ishan Roy', 'ishan', 'Backend', 'IR')],
  },
]

export const ownTeam = teams.find((team) => team.id === ownTeamId)!
