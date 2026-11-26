-- Score history is append-only. Corrections must be represented by reversal rows.
-- This protects the invariant even if an application code path issues UPDATE/DELETE.
CREATE OR REPLACE FUNCTION app.reject_score_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'score ledger is append-only; create a reversal entry instead'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_score_ledger_append_only
BEFORE UPDATE OR DELETE ON app.score_ledger_entries
FOR EACH ROW
EXECUTE FUNCTION app.reject_score_ledger_mutation();
