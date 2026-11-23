"""Central configuration for the Bug Hunt CTF platform (D0/D1 profile).

Runtime configuration is read from the environment (or a .env file) and validated
at startup. Nothing here may embed secrets; development defaults are clearly
marked as dev-only and never used by a live deployment without override.
"""
from __future__ import annotations

import os
from functools import lru_cache

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

    # --- limits (server-side, authoritative) ---------------------------------
    max_body_bytes: int = 512 * 1024
    submission_max_desc_chars: int = 2000
    max_concurrent_requests_per_user: int = 20

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
