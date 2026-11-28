-- Account status is not part of the event's account model.
-- Preserve historical user rows for score/audit foreign keys, but revoke access
-- for records that were explicitly disabled or disqualified in older builds.
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

-- Staff accounts do not need a team membership to sign in. Clearing their
-- password hash is what prevents an old disabled staff account from returning.
UPDATE app.users
SET password_hash = NULL
WHERE status IN ('disabled', 'disqualified');

DELETE FROM app.team_members tm
USING app.users u
WHERE tm.user_id = u.id
  AND u.status IN ('disabled', 'disqualified');

ALTER TABLE app.users DROP COLUMN status;
