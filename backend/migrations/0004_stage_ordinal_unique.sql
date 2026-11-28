-- 0004_stage_ordinal_unique.sql: enforce unique stage ordinals per (event, kind).
--
-- F-C-16 (Section 5.1 admin remediation): stage creation allocated the next
-- ordinal with application-side MAX+1, so two concurrent requests could commit
-- duplicate ordinals. This migration adds the database-level invariant the
-- audit prescribes: UNIQUE (event_id, kind, ordinal).
--
-- Forward-only, expand-only: no existing row is deleted, reordered or rewritten.
-- The guard refuses to run when duplicate (event_id, kind, ordinal) groups
-- already exist, so the constraint can never silently hide bad data; a human
-- must resolve the duplicates first and re-run scripts/migrate.sh.

DO $$
DECLARE
    duplicate_groups integer;
BEGIN
    SELECT count(*) INTO duplicate_groups
    FROM (
        SELECT 1 FROM app.stages
        GROUP BY event_id, kind, ordinal
        HAVING count(*) > 1
    ) AS d;
    IF duplicate_groups > 0 THEN
        RAISE EXCEPTION
            'cannot add ux_stages_event_kind_ordinal: % duplicate (event_id, kind, ordinal) group(s) exist in app.stages; resolve them before migrating',
            duplicate_groups
            USING HINT = 'Reassign ordinals manually for the affected events, then re-run scripts/migrate.sh.';
    END IF;
END
$$;

ALTER TABLE app.stages
    ADD CONSTRAINT ux_stages_event_kind_ordinal UNIQUE (event_id, kind, ordinal);
