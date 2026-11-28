-- Team status is not part of the account/team model. Disqualification is
-- represented by removing the participant's membership or deleting the team.
-- Keep the schema aligned with the model and authorization queries.
BEGIN;

ALTER TABLE app.teams DROP COLUMN IF EXISTS status;

COMMIT;
