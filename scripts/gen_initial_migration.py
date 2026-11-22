#!/usr/bin/env python
"""One-time generator for migrations/0001_init.sql from the SQLAlchemy models.

Kept in the repository for provenance. Future schema changes are hand-written
ordered SQL files applied by scripts/migrate.sh (ADR-018: plain versioned SQL
migrations; expand/contract; no destructive changes without a forward fix).
"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

from sqlalchemy.dialects import postgresql  # noqa: E402
from sqlalchemy.schema import CreateTable, CreateIndex  # noqa: E402

from app import models_app, models_gt  # noqa: E402

OUT = BACKEND / "migrations" / "0001_init.sql"
PG_DIALECT = postgresql.dialect()


def compile_metadata(metadata, schema: str, lines: list[str]) -> None:
    lines.append(f"-- ===== schema: {schema} =====")
    for table in metadata.sorted_tables:
        ddl = str(CreateTable(table).compile(dialect=PG_DIALECT)).strip() + ";"
        lines.append(ddl)
        lines.append("")
    for table in metadata.sorted_tables:
        for index in table.indexes:
            lines.append(str(CreateIndex(index).compile(dialect=PG_DIALECT)).strip() + ";")
    lines.append("")


def main() -> None:
    lines = [
        "-- 0001_init.sql: initial schema for the Bug Hunt CTF platform (v1).",
        "-- Applied by scripts/migrate.sh in order. Idempotency: tracked in app.schema_migrations.",
        "",
        "-- ===== schema: audit (append-only) =====",
        """CREATE SCHEMA IF NOT EXISTS audit;
CREATE SEQUENCE IF NOT EXISTS audit.entries_seq;
CREATE TABLE IF NOT EXISTS audit.entries (
    id UUID PRIMARY KEY,
    event_scope VARCHAR(120) NOT NULL DEFAULT 'global',
    seq BIGINT NOT NULL DEFAULT nextval('audit.entries_seq'),
    actor_id UUID,
    actor_role VARCHAR(30) NOT NULL,
    action VARCHAR(80) NOT NULL,
    entity_type VARCHAR(60) NOT NULL,
    entity_id VARCHAR(80),
    request_id VARCHAR(64) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    prev_hash VARCHAR(64) NOT NULL,
    hash VARCHAR(64) NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_audit_entries_scope_seq ON audit.entries (event_scope, seq);
CREATE INDEX IF NOT EXISTS ix_audit_entries_action ON audit.entries (action);
CREATE INDEX IF NOT EXISTS ix_audit_entries_actor ON audit.entries (actor_id);""",
        "",
        "-- ===== schema: app (participant/admin domain) =====",
    ]
    compile_metadata(models_app.AppBase.metadata, "app", lines)
    lines.append("-- ===== schema: gt (ground truth; restricted to gt_admin) =====")
    compile_metadata(models_gt.GtBase.metadata, "gt", lines)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines))
    print(f"wrote {OUT} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
