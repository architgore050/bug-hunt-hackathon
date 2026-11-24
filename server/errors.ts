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
    super(message || entry[1])
    this.code = code
    this.status = entry[0]
    this.details = details
  }
}

export function formatApiErrorMessage(err: ApiError, requestId: string): string {
  let msg = err.message.replace('{request_id}', requestId)
  for (const [k, v] of Object.entries(err.details)) {
    msg = msg.replace(`{${k}}`, String(v))
  }
  return msg
}
