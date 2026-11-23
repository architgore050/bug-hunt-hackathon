import type {
  Announcement,
  Assignment,
  AuditVerification,
  DisputeItem,
  DraftPayload,
  FileContentResponse,
  LeaderboardResponse,
  MeResponse,
  PublicEvent,
  PublicRules,
  ReadinessItem,
  ResultsResponse,
  ReviewDecision,
  ReviewItemDetail,
  ReviewQueueItem,
  Rubric,
  SearchMatch,
  StateResponse,
  SubmissionDetail,
  SubmissionIn,
  SubmissionItem,
  SubmissionReceipt,
  SystemHealth,
  User,
} from './types';

export class ApiError extends Error {
  code: string;
  status: number;
  requestId: string;
  details: Record<string, unknown>;

  constructor(code: string, status: number, message: string, requestId: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

let inMemoryToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  inMemoryToken = token;
}

export function getAccessToken(): string | null {
  return inMemoryToken;
}

function generateRequestId(): string {
  return 'req-' + Math.random().toString(36).substring(2, 10);
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : endpoint;
  const headers = new Headers(options.headers || {});
  
  if (!headers.has('X-Request-Id')) {
    headers.set('X-Request-Id', generateRequestId());
  }

  if (inMemoryToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (err: unknown) {
    throw new ApiError('NETWORK', 0, 'Network connection failure. Verify server availability.', headers.get('X-Request-Id') || 'unknown');
  }

  const requestId = response.headers.get('X-Request-Id') || headers.get('X-Request-Id') || 'unknown';

  if (!response.ok) {
    let errorJson: { error?: { code?: string; message?: string; request_id?: string; details?: Record<string, unknown> } } = {};
    try {
      errorJson = await response.json();
    } catch {
      // not json
    }

    const errorBody = errorJson.error || {};
    const code = errorBody.code || `HTTP_${response.status}`;
    const message = errorBody.message || response.statusText || 'Request failed';
    const details = errorBody.details || {};

    // Auto-refresh token if expired
    if (response.status === 401 && code === 'AUTH_TOKEN_EXPIRED' && !isRetry) {
      const newToken = await refreshToken();
      if (newToken) {
        return apiFetch<T>(endpoint, options, true);
      }
    }

    throw new ApiError(code, response.status, message, requestId, details);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export async function refreshToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const res = await fetch('/v1/auth/refresh', {
        method: 'POST',
        headers: {
          'X-BHCTF-Client': '1',
          'X-Request-Id': generateRequestId(),
        },
      });
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const data = await res.json();
      setAccessToken(data.access_token);
      return data.access_token as string;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// API methods
export const api = {
  // Public
  getTime: () => apiFetch<{ server_time_ms: number; server_time: string }>('/v1/time'),
  getPublicEvent: () => apiFetch<{ event: PublicEvent | null }>('/v1/public/event'),
  getPublicRules: () => apiFetch<{ rules: PublicRules | null }>('/v1/public/rules'),
  getHealth: () => apiFetch<SystemHealth>('/health'),

  // Auth
  login: (data: { email: string; password: string }) =>
    apiFetch<{ access_token: string; expires_at: string; server_time: string; user: User }>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  logout: () =>
    apiFetch<{ ok: boolean }>('/v1/auth/logout', { method: 'POST' }),
  activate: (data: { invite_token: string; password: string; accept_rules: boolean }) =>
    apiFetch<{ ok: boolean; email: string }>('/v1/auth/activate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  stepUp: (password: string) =>
    apiFetch<{ ok: boolean; valid_until: string }>('/v1/auth/step-up', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  getMe: () => apiFetch<MeResponse>('/v1/me'),
  acceptRules: (version?: string) =>
    apiFetch<{ ok: boolean; rules_version: string }>('/v1/me/acceptances', {
      method: 'POST',
      body: JSON.stringify({ version }),
    }),

  // State & Config
  getState: () => apiFetch<StateResponse>('/v1/state'),
  getConfig: () => apiFetch<Record<string, unknown>>('/v1/config'),
  getAnnouncements: (limit = 50) => apiFetch<Announcement[]>(`/v1/announcements?limit=${limit}`),

  // Participant Assignments & Files
  getAssignments: () => apiFetch<{ assignments: Assignment[]; message?: string }>('/v1/assignments'),
  getFileContent: (challengeId: string, path: string) =>
    apiFetch<FileContentResponse>(`/v1/challenges/${challengeId}/files/content?path=${encodeURIComponent(path)}`),
  searchChallenge: (challengeId: string, q: string) =>
    apiFetch<SearchMatch[]>(`/v1/challenges/${challengeId}/search?q=${encodeURIComponent(q)}`),

  // Submissions & Drafts
  submitReport: (payload: SubmissionIn, idempotencyKey: string) =>
    apiFetch<SubmissionReceipt>('/v1/submissions', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    }),
  getSubmissions: () => apiFetch<SubmissionItem[]>('/v1/submissions'),
  getSubmission: (id: string) => apiFetch<SubmissionDetail>(`/v1/submissions/${id}`),
  disputeSubmission: (id: string, statement: string) =>
    apiFetch<{ ok: boolean }>(`/v1/submissions/${id}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ statement }),
    }),
  getDraft: (challengeId: string) => apiFetch<DraftPayload>(`/v1/drafts/${challengeId}`),
  saveDraft: (challengeId: string, payload: Partial<SubmissionIn>, version?: number) =>
    apiFetch<{ version: number; updated_at: string }>(`/v1/drafts/${challengeId}`, {
      method: 'PUT',
      body: JSON.stringify({ payload, version }),
    }),

  // Leaderboard & Results
  getLeaderboard: (stageId: string) => apiFetch<LeaderboardResponse>(`/v1/leaderboard/${stageId}`),
  getResults: (stageId: string) => apiFetch<ResultsResponse>(`/v1/results/${stageId}`),

  // Review
  getReviewQueue: () => apiFetch<ReviewQueueItem[]>('/v1/review/queue'),
  claimReviewItem: (itemId: string) =>
    apiFetch<{ ok: boolean; claimed_until: string }>(`/v1/review/items/${itemId}/claim`, { method: 'POST' }),
  getReviewItem: (itemId: string) => apiFetch<ReviewItemDetail>(`/v1/review/items/${itemId}`),
  decideReviewItem: (itemId: string, decision: ReviewDecision, rubric: Rubric, notes?: string) =>
    apiFetch<{ ok: boolean }>(`/v1/review/items/${itemId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, rubric, notes }),
    }),

  // Admin
  getAdminEvents: () => apiFetch<Array<{ id: string; name: string; slug: string; status: string }>>('/v1/admin/events'),
  createAdminEvent: (data: { name: string; slug: string; duration_minutes?: number; max_participants?: number; max_teams?: number; timezone?: string }) =>
    apiFetch<{ event_id: string }>('/v1/admin/events', { method: 'POST', body: JSON.stringify(data) }),
  getLiveOps: (eventId: string) => apiFetch<Record<string, unknown>>(`/v1/admin/events/${eventId}/live`),
  controlStage: (stageId: string, action: string, reason: string, seconds?: number) =>
    apiFetch<{ ok: boolean }>(`/v1/admin/stages/${stageId}/control`, {
      method: 'POST',
      body: JSON.stringify({ action, reason, seconds }),
    }),
  postAnnouncement: (eventId: string, severity: 'info' | 'warning' | 'critical', body: string) =>
    apiFetch<{ ok: boolean }>(`/v1/admin/events/${eventId}/announcements`, {
      method: 'POST',
      body: JSON.stringify({ severity, body }),
    }),
  getReadiness: (eventId: string) => apiFetch<ReadinessItem[]>(`/v1/admin/events/${eventId}/readiness`),
  setReadinessItem: (eventId: string, key: string, state: 'checked' | 'unchecked' | 'na') =>
    apiFetch<{ ok: boolean }>(`/v1/admin/events/${eventId}/readiness/${key}`, {
      method: 'POST',
      body: JSON.stringify({ state }),
    }),
  verifyAudit: () => apiFetch<AuditVerification>('/v1/admin/audit/verify'),
  getDisputes: () => apiFetch<DisputeItem[]>('/v1/admin/disputes'),
  resolveDispute: (id: string, outcome: 'upheld' | 'rejected', resolution: string, adjust_points?: number) =>
    apiFetch<{ ok: boolean }>(`/v1/admin/disputes/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ outcome, resolution, adjust_points }),
    }),
  exportCsv: (eventId: string, kind: 'results' | 'submissions' | 'ledger') =>
    apiFetch<{ filename: string; content: string }>(`/v1/admin/events/${eventId}/export/${kind}`),
  createChallenge: (eventId: string, data: { slug: string; title: string; instructions_markdown?: string }) =>
    apiFetch<{ challenge_id: string }>(`/v1/admin/events/${eventId}/challenges`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  uploadChallengeFile: (challengeId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiFetch<{ ok: boolean; path: string; line_count: number }>(`/v1/admin/challenges/${challengeId}/files`, {
      method: 'POST',
      body: formData,
    });
  },
  freezeChallenge: (challengeId: string) =>
    apiFetch<{ ok: boolean; content_hash: string }>(`/v1/admin/challenges/${challengeId}/freeze`, { method: 'POST' }),
  publishChallenge: (challengeId: string, stageId: string) =>
    apiFetch<{ ok: boolean }>(`/v1/admin/challenges/${challengeId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ stage_id: stageId }),
    }),
  recordTestResults: (challengeId: string, submissionId: string, testsPassed: number, testsTotal: number) =>
    apiFetch<{ ok: boolean }>(`/v1/admin/challenges/${challengeId}/ground-truth/test-results`, {
      method: 'POST',
      body: JSON.stringify({ submission_id: submissionId, tests_passed: testsPassed, tests_total: testsTotal }),
    }),
};
