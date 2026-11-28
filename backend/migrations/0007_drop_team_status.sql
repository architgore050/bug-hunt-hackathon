-- Team status is not part of the event's team model. There is no producer for
-- a non-active team state in current code: disqualification is expressed by
-- removing the member from the team (admin roster management) or deleting the
-- team, which already revokes access. Dropping the dead column keeps the schema
-- honest; wrapped in a transaction so a crash mid-file cannot wedge re-application.
BEGIN;

ALTER TABLE app.teams DROP COLUMN status;

COMMIT;
