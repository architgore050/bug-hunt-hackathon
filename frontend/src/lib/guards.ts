// Route guard logic for the four-level participant routes.
//
// Guards are UX only: every backend endpoint repeats the authorization and
// pointer checks. The frontend redirects stale, future, locked and submitted
// URLs to the server's current permitted node so navigation always follows
// GET /v1/progress.

import type { NodePointer } from './api-levels'

export type LevelRouteNode = 'explain' | 'run'

/**
 * Returns the path the participant should be sent to instead, or null when
 * the requested route is permitted.
 *
 * Rules:
 * - pointer done -> dashboard.
 * - pointer on a later level than the requested one -> current node.
 * - pointer on an earlier level (requested level submitted or not yet open)
 *   -> current node.
 * - within the current level both nodes are reachable: entering the run page
 *   performs the server-side explain -> exec transition (GET
 *   /v1/levels/{n}/workspace), and the gate is re-checked there by the
 *   backend. Explain stays readable while working in the exec node.
 */
export function guardRedirect(
  pointer: NodePointer | null | undefined,
  targetLevel: number,
  /** Kept for call-site clarity: both nodes of the current level are reachable. */
  _targetNode: LevelRouteNode,
): string | null {
  if (!pointer) return null
  if (pointer.node === 'done') return '/dashboard'
  if (pointer.level_no > targetLevel || pointer.level_no < targetLevel) {
    return nodePath(pointer.level_no, pointer.node)
  }
  return null
}

/** Path for the server's current node. */
export function nodePath(levelNo: number, node: NodePointer['node']): string {
  if (node === 'done') return '/dashboard'
  if (node === 'exec') return `/level/${levelNo}/run`
  return `/level/${levelNo}/explain`
}
