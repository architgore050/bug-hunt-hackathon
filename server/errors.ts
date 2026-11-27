import type { NextFunction, Request, Response } from 'express'

export const ERROR_CATALOG: Record<string, [number, string]> = {
  AUTH_INVALID_CREDENTIALS: [401, 'Email or password is incorrect.'],
  AUTH_TOKEN_EXPIRED: [401, 'Your session expired. Please sign in again.'],
  AUTH_SESSION_REVOKED: [401, 'Your session ended. Please sign in again.'],
  AUTH_RATE_LIMITED: [429, 'Too many attempts. Try again in {n} seconds.'],
  AUTH_FORBIDDEN: [403, 'You do not have access to this.'],
  AUTH_NOT_ACTIVATED: [403, 'Your account is not activated. Use the invite link from your email.'],
  RULES_NOT_ACCEPTED: [403, 'Please accept the current rules to continue.'],
  ROUND_NOT_ACTIVE: [409, 'This round is not active.'],
  ROUND_PAUSED: [409, 'The round is paused. Your timer is stopped.'],
  ROUND_ENDED: [409, 'Time is up. This report was not accepted.'],
  SUBMISSION_INVALID: [422, 'Some fields are invalid.'],
  SUBMISSION_CAP_REACHED: [429, 'You have reached the report limit for this file.'],
  SUBMISSION_COOLDOWN: [429, 'Please wait {n} seconds before another report on this file.'],
  IDEMPOTENCY_CONFLICT: [409, 'This request conflicts with an earlier one.'],
  DRAFT_VERSION_CONFLICT: [412, 'This draft was changed in another tab.'],
  RUN_RATE_LIMITED: [429, 'Please wait {n} seconds before running again.'],
  RUN_LANGUAGE_UNSUPPORTED: [422, 'This language is not available.'],
  RUNNER_UNAVAILABLE: [503, 'Running code is unavailable right now. You can still write and submit reports.'],
  FILE_NOT_FOUND: [404, 'File not found.'],
  PATH_INVALID: [400, 'Invalid path.'],
  KEY_NOT_AVAILABLE: [425, 'The round has not started.'],
  SERVICE_DEGRADED: [503, 'Service is busy. Your work is saved and will be sent automatically.'],
  ADMIN_STEP_UP_REQUIRED: [403, 'Confirm your identity to continue.'],
  GROUND_TRUTH_LOCKED: [409, 'This version is frozen. Create a revision.'],
  REPO_ALREADY_LOCKED: [409, 'Your team already locked a repository option. The choice is final.'],
  REPO_NOT_LOCKED: [409, 'Your team lead has not locked a repository yet.'],
  LEVEL_NOT_OPEN: [409, 'This level is not open yet.'],
  TEAM_GATE_BLOCKED: [409, 'Your team cannot enter this level yet. Some teammates are still working.'],
  LEVEL_ALREADY_SUBMITTED: [409, 'This level is already submitted and cannot be reopened.'],
  ARTIFACT_INVALID: [422, 'The uploaded artifact is invalid.'],
  ARTIFACT_REQUIRED: [422, 'This level needs an uploaded artifact or a computed diff.'],
  LOCATION_INVALID: [422, 'One of the file locations is invalid.'],
  FLAG_INVALID: [422, 'This flag was not accepted.'],
  FLAG_ALREADY_SUBMITTED: [409, 'Your team already submitted this flag.'],
  NOT_FOUND: [404, 'Not found.'],
  VALIDATION_ERROR: [422, 'Some fields are invalid.'],
  INTERNAL_ERROR: [500, 'Something went wrong. Reference: {request_id}.'],
}

export class ApiError extends Error {
  code: string
  status: number
  details: Record<string, unknown>

  constructor(code: string, details: Record<string, unknown> = {}, message?: string) {
    const entry = ERROR_CATALOG[code] ?? [400, 'Request failed.']
    const msg = message || entry[1]
    super(msg)
    this.code = code
    this.status = entry[0]
    this.details = details
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

export function formatErrorMessage(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (vars[key] !== undefined && vars[key] !== null) return String(vars[key])
    return match
  })
}

export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as Request & { requestId?: string }).requestId ?? '-'
  res.setHeader('X-Request-Id', requestId)

  if (err instanceof ApiError) {
    const message = formatErrorMessage(err.message, { request_id: requestId, ...err.details })
    res.status(err.status).json({
      error: {
        code: err.code,
        message,
        request_id: requestId,
        details: err.details,
      },
    })
    return
  }

  console.error('[server error]', requestId, err)
  const message = formatErrorMessage(ERROR_CATALOG.INTERNAL_ERROR[1], { request_id: requestId })
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message,
      request_id: requestId,
      details: {},
    },
  })
}
