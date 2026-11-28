"""Error envelope and error catalog (spec §15).

Every API error uses the same shape:
    {"error": {"code", "message", "request_id", "details"}}
and carries an X-Request-Id response header. User-facing messages are stable,
generic where they must not leak account state (AUTH-1).
"""

from __future__ import annotations

import contextlib

from fastapi import Request
from fastapi.responses import JSONResponse

CATALOG: dict[str, tuple[int, str]] = {
    "AUTH_INVALID_CREDENTIALS": (401, "Email or password is incorrect."),
    "AUTH_TOKEN_EXPIRED": (401, "Your session expired. Please sign in again."),
    "AUTH_SESSION_REVOKED": (401, "Your session ended. Please sign in again."),
    "AUTH_RATE_LIMITED": (429, "Too many attempts. Try again in {n} seconds."),
    "AUTH_FORBIDDEN": (403, "You do not have access to this."),
    "RULES_NOT_ACCEPTED": (403, "Please accept the current rules to continue."),
    "ROUND_NOT_ACTIVE": (409, "This round is not active."),
    "ROUND_PAUSED": (409, "The round is paused. Your timer is stopped."),
    "ROUND_ENDED": (409, "Time is up. This report was not accepted."),
    "SUBMISSION_INVALID": (422, "Some fields are invalid."),
    "SUBMISSION_CAP_REACHED": (429, "You have reached the report limit for this file."),
    "SUBMISSION_COOLDOWN": (429, "Please wait {n} seconds before another report on this file."),
    "IDEMPOTENCY_CONFLICT": (409, "This request conflicts with an earlier one."),
    "DRAFT_VERSION_CONFLICT": (412, "This draft was changed in another tab."),
    "RUN_RATE_LIMITED": (429, "Please wait {n} seconds before running again."),
    "RUN_LANGUAGE_UNSUPPORTED": (422, "This language is not available."),
    "RUNNER_UNAVAILABLE": (503, "Running code is unavailable right now. You can still write and submit reports."),
    "FILE_NOT_FOUND": (404, "File not found."),
    "PATH_INVALID": (400, "Invalid path."),
    "KEY_NOT_AVAILABLE": (425, "The round has not started."),
    "SERVICE_DEGRADED": (503, "Service is busy. Your work is saved and will be sent automatically."),
    "ADMIN_STEP_UP_REQUIRED": (403, "Confirm your identity to continue."),
    "GROUND_TRUTH_LOCKED": (409, "This version is frozen. Create a revision."),
    "REPO_ALREADY_LOCKED": (409, "Your team already locked a repository option. The choice is final."),
    "REPO_NOT_LOCKED": (409, "Your team lead has not locked a repository yet."),
    "LEVEL_NOT_OPEN": (409, "This level is not open yet."),
    "TEAM_GATE_BLOCKED": (409, "Your team cannot enter this level yet. Some teammates are still working."),
    "LEVEL_ALREADY_SUBMITTED": (409, "This level is already submitted and cannot be reopened."),
    "ARTIFACT_INVALID": (422, "The uploaded artifact is invalid."),
    "ARTIFACT_REQUIRED": (422, "This level needs an uploaded artifact or a computed diff."),
    "LOCATION_INVALID": (422, "One of the file locations is invalid."),
    "FLAG_INVALID": (422, "This flag was not accepted."),
    "FLAG_ALREADY_SUBMITTED": (409, "Your team already submitted this flag."),
    "NOT_FOUND": (404, "Not found."),
    "VALIDATION_ERROR": (422, "Some fields are invalid."),
    "INTERNAL_ERROR": (500, "Something went wrong. Reference: {request_id}."),
}


class ApiError(Exception):
    def __init__(self, code: str, details: dict | None = None, message: str | None = None):
        status, default = CATALOG.get(code, (400, "Request failed."))
        self.code = code
        self.status = status
        self.message = message or default
        self.details = details or {}
        super().__init__(self.message)


async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    request_id = getattr(_.state, "request_id", "-")
    message = exc.message
    with contextlib.suppress(KeyError, IndexError):
        message = message.format(request_id=request_id, **exc.details)
    body = {"error": {"code": exc.code, "message": message, "request_id": request_id, "details": exc.details}}
    return JSONResponse(status_code=exc.status, content=body, headers={"X-Request-Id": request_id})


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "-")
    message = CATALOG["INTERNAL_ERROR"][1].format(request_id=request_id)
    body = {"error": {"code": "INTERNAL_ERROR", "message": message, "request_id": request_id, "details": {}}}
    return JSONResponse(status_code=500, content=body, headers={"X-Request-Id": request_id})
