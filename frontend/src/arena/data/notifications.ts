import type { NotificationItem } from '../types'

export const notifications: NotificationItem[] = [
  { id: 'N-01', kind: 'level', title: 'Level 3 unlocked', body: 'Repair mode is live. AI assistance is now available.', time: 'Today, 09:00', read: false },
  { id: 'N-02', kind: 'repo', title: 'Repository assigned', body: 'papyrus is assigned for Levels 1 to 3 on branch challenge/main.', time: 'Today, 09:02', read: false },
  { id: 'N-03', kind: 'score', title: 'Score updated', body: 'Two issue reports were accepted. +42 points.', time: 'Today, 10:15', read: false },
  { id: 'N-04', kind: 'question', title: 'New repair task', body: 'Repair authentication bypass is available in the task panel.', time: 'Today, 10:30', read: false },
  { id: 'N-05', kind: 'issue', title: 'Issue accepted', body: 'Raw markup rendering was confirmed. +28 points.', time: 'Today, 11:05', read: true },
  { id: 'N-06', kind: 'rank', title: 'Rank changed', body: 'Your team moved from rank 3 to rank 2.', time: 'Today, 11:20', read: true },
  { id: 'N-07', kind: 'flag', title: 'Flag accepted', body: 'The Forgotten Header bonus was recorded. +20 bonus points.', time: 'Today, 11:48', read: true },
  { id: 'N-08', kind: 'announcement', title: 'Admin announcement', body: 'The evaluator will run at the top of every hour. Keep commits small.', time: 'Today, 12:00', read: true },
  { id: 'N-09', kind: 'time', title: 'Time check', body: 'The event ends at 18:00. Plan the final repair accordingly.', time: 'Today, 12:30', read: true },
  { id: 'N-10', kind: 'issue', title: 'Issue marked duplicate', body: 'The static token report matched an earlier submission.', time: 'Today, 11:42', read: true },
]
