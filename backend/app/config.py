"""Central configuration for the Bug Hunt CTF platform (D0/D1 profile).

Runtime configuration is read from the environment (or a .env file) and validated
at startup. Nothing here may embed secrets; development defaults are clearly
marked as dev-only and never used by a live deployment without override.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- deployment profile -------------------------------------------------
    profile: str = "d0-local"  # d0-local | d1-free-vm ; d2 is out of scope for v1
    environment: str = "development"  # development | production

    # --- database -----------------------------------------------------------
    # The participant/admin API connects as app_api which CANNOT read the gt schema.
    database_url_app: str = "postgresql+psycopg://app_api:app_api_dev@127.0.0.1:5434/bughunt"
    # Only the evaluator/ground-truth paths use this restricted connection.
    database_url_gt: str = "postgresql+psycopg://gt_admin:gt_admin_dev@127.0.0.1:5434/bughunt"
    db_pool_size: int = 8
    db_max_overflow: int = 4
    # REM-002 (CRITICAL): this process currently holds BOTH DB roles -- app_api
    # for the participant surface and gt_admin for the admin/GT routers -- so
    # the answer-key trust boundary is process-level, not only SQL-role-level.
    # When the evaluator split lands, the participant API must run with
    # database_url_gt deliberately unset/empty (gt_credential_required=False)
    # and refuse to start if an admin/GT route is mounted; the pre-split
    # default True keeps the combined process booting as it does today.
    gt_credential_required: bool = True
    # REM-002: production must either complete the evaluator split or set
    # EVALUATOR_SPLIT=1 to explicitly acknowledge running pre-split with the GT
    # credential still in this process (enforced by validate_production_config).
    evaluator_split_acknowledged: bool = Field(default=False, alias="EVALUATOR_SPLIT")

    # --- auth ----------------------------------------------------------------
    # DEV ONLY DEFAULTS. A live deployment MUST override all of these.
    jwt_secret: str = "dev-only-insecure-secret-replace-me"  # MUST be overridden in any real deployment
    jwt_algorithm: str = "HS256"  # pinned; HS256 only. EdDSA/Ed25519 is a P1 follow-up requiring a key-file setting
    access_token_ttl_s: int = 600  # 10 minutes
    refresh_token_ttl_s: int = 86400 * 3
    refresh_reuse_grace_s: int = 10  # AUTH-04: same-successor retry window
    cookie_domain: str = ""  # empty = host-only (spec 4.1)
    max_sessions_per_user: int = 2  # AUTH-10
    password_min_length: int = 12

    # --- Argon2 resource bounds (REM-072) ------------------------------------
    # Login/step-up are CPU-bound (Argon2id).  Under a burst an attacker can
    # amplify cost; these bounds cap memory + time per verification so a burst
    # degrades gracefully rather than exhausting the worker.  Defaults match
    # the OWASP ASVS L2 recommendation for a single-server deployment.
    argon2_time_cost: int = 3
    argon2_memory_cost: int = 65536  # 64 MiB
    argon2_parallelism: int = 2

    # --- client compatibility (REM-075) --------------------------------------
    # Minimum frontend build the API will serve.  A request whose
    # ``X-Client-Version`` is below this is rejected with
    # ``CLIENT_VERSION_UNSUPPORTED`` so a stale cached SPA cannot drive a
    # broken contract against a newer API.  Empty = no gate (dev).
    minimum_client_version: str = ""
    client_version_header: str = "X-Client-Version"

    # --- limits (server-side, authoritative) ---------------------------------
    max_body_bytes: int = 512 * 1024
    submission_max_desc_chars: int = 2000
    max_concurrent_requests_per_user: int = 20
    # Artifact uploads (Levels 3-4): spec default 5 MB; the transport cap adds
    # headroom for multipart encoding. Configurable per deployment.
    max_upload_bytes: int = 6 * 1024 * 1024
    artifact_storage_dir: str = ""  # empty = <repo>/data/artifacts (D0 local; gitignored)

    # --- feature switches (kill switches, degradation order) ----------------
    runner_enabled: bool = False  # ADR-010 fallback: disabled unless an isolated runner VM exists
    ai_assessment_enabled: bool = False  # DEC-13 / master prompt: off until an approved provider is verified
    telemetry_enabled: bool = False

    # --- observability -------------------------------------------------------
    log_level: str = "INFO"
    frontend_origin: str = "http://localhost:5173"  # exact CORS allow-list entry; comma-separated for more


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def cors_origins() -> list[str]:
    return [o.strip() for o in settings.frontend_origin.split(",") if o.strip()]


# Sentinel dev-only values that MUST be overridden in any non-development
# deployment (REM-025).  Startup calls :func:`validate_production_config` and
# refuses to boot when these leak into production, so a misconfigured release
# fails closed rather than silently running on insecure defaults.
_DEV_ONLY_SENTINELS = {
    "jwt_secret": "dev-only-insecure-secret-replace-me",
    "database_url_app": "postgresql+psycopg://app_api:app_api_dev@127.0.0.1:5434/bughunt",
    "database_url_gt": "postgresql+psycopg://gt_admin:gt_admin_dev@127.0.0.1:5434/bughunt",
}


def validate_production_config() -> list[str]:
    """Return a list of fail-closed violations for a production environment.

    Empty list = OK to boot.  Non-empty = the caller (``main.lifespan``) must
    raise and refuse to start.  We never silently run a production process on
    development secrets, dev database URLs, or an empty CORS allow-list.
    """
    violations: list[str] = []
    if settings.environment != "production":
        return violations  # dev/staging may use the dev defaults
    for key, sentinel in _DEV_ONLY_SENTINELS.items():
        if getattr(settings, key) == sentinel:
            violations.append(f"{key} is still the dev-only default; override it for production.")
    if settings.profile == "d0-local":
        violations.append("profile is d0-local; production requires d1-free-vm or higher.")
    if not cors_origins():
        violations.append("frontend_origin CORS allow-list is empty; production needs an explicit origin.")
    if settings.cookie_domain and not settings.cookie_domain.startswith("."):
        violations.append("cookie_domain should be a host-only ('') or a dot-prefixed domain.")
    if settings.access_token_ttl_s > 3600:
        violations.append("access_token_ttl_s exceeds 1 hour; tighten for production.")
    # REM-002 (CRITICAL): the participant API process holds the GT credential
    # (database_url_gt) together with the admin/GT routers.  A d0-local dev
    # profile using the gt_admin dev credential is fine (early return above);
    # production must either complete the evaluator split so the participant
    # process runs without the GT credential, or explicitly acknowledge
    # running pre-split via EVALUATOR_SPLIT=1.
    if not settings.evaluator_split_acknowledged:
        violations.append(
            "REM-002: the GT credential is present in the participant API process; complete the evaluator "
            "split (docs/SECURITY_ARCHITECTURE.md) or acknowledge it with EVALUATOR_SPLIT=1."
        )
    return violations
