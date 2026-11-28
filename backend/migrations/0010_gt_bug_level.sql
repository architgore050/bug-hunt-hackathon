-- Ground truth bugs gain an optional level scope. The four-level flow matches
-- reports against candidates filtered by the submission's level, so a Level 1
-- single-location report can no longer win a Level 2 chain award once one
-- catalog is shared across levels (expansion spec 1.4). NULL keeps legacy
-- fixtures (which predate levels) matchable on every level.
ALTER TABLE gt.gt_bugs ADD COLUMN level INTEGER;
