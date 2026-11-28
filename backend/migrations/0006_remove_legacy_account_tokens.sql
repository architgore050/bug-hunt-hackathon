-- This event no longer uses invite activation or public self-service password reset.
-- Accounts are registered by admins; a registered passwordless account claims its
-- initial password on first sign-in. Retire outstanding legacy token records.
BEGIN;

DROP TABLE IF EXISTS app.invites;
DROP TABLE IF EXISTS app.password_resets;

COMMIT;
