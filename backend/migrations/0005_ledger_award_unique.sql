-- 0005_ledger_award_unique.sql: enforce one effective award entry per
-- (submission, award unit, component).
--
-- Review issue A: award writes were check-then-insert. A redelivered review or
-- test-result job could overlap a release pass and both pass the application
-- check, appending duplicate award rows and double-scoring the same unit.
-- The database now arbitrates. Corrections and team penalties are unaffected
-- because the index only covers kind = 'award'.
--
-- Forward-only, expand-only: no existing row is deleted or rewritten. The
-- guard refuses to run when duplicates already exist so bad data cannot be
-- hidden by the new constraint; a human must resolve it first.

DO $$
DECLARE
    duplicate_groups integer;
BEGIN
    SELECT count(*) INTO duplicate_groups
    FROM (
        SELECT 1 FROM app.score_ledger_entries
        WHERE kind = 'award'
        GROUP BY submission_id, award_unit_id, component
        HAVING count(*) > 1
    ) AS d;
    IF duplicate_groups > 0 THEN
        RAISE EXCEPTION
            'cannot add uq_ledger_award_unit: % duplicate award group(s) exist in app.score_ledger_entries; resolve them before migrating',
            duplicate_groups
            USING HINT = 'Reverse duplicate award entries manually, then re-run scripts/migrate.sh.';
    END IF;
END
$$;

CREATE UNIQUE INDEX uq_ledger_award_unit
    ON app.score_ledger_entries (submission_id, award_unit_id, component)
    WHERE kind = 'award';
