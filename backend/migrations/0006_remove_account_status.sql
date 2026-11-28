-- Account status is not part of the event's account model.
-- Preserve historical user rows for score/audit foreign keys, but revoke access
-- for records that were explicitly disabled or disqualified in older builds.
-- Note: legacy rows still marked 'pending' (the 0001 default, with no producer
-- left in current code) intentionally fall back to the new claim rules: a
-- participant attached to a team can claim a first password, anything else
-- stays credential-less until an admin registers it.
-- The whole file runs as one transaction (scripts/migrate.sh applies with
-- autocommit per statement, so the explicit BEGIN/COMMIT is required): a crash
-- between the final DROP COLUMN and the schema_migrations record must not wedge
-- re-application with "column does not exist".
BEGIN;

UPDATE app.sessions s
SET revoked_at = COALESCE(s.revoked_at, now())
FROM app.users u
WHERE s.user_id = u.id
  AND u.status IN ('disabled', 'disqualified');

UPDATE app.refresh_tokens rt
SET status = 'revoked'
FROM app.users u
WHERE rt.user_id = u.id
  AND u.status IN ('disabled', 'disqualified');

-- Clearing the password hash for every legacy disabled/disqualified account
-- prevents an old credential from being reactivated if an administrator later reassigns a team.
UPDATE app.users
SET password_hash = NULL
WHERE status IN ('disabled', 'disqualified');

DELETE FROM app.team_members tm
USING app.users u
WHERE tm.user_id = u.id
  AND u.status IN ('disabled', 'disqualified');

ALTER TABLE app.users DROP COLUMN status;

COMMIT;
