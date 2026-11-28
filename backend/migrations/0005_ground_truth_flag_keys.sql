-- Flag keys are stable award-unit identifiers within a challenge version.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gt_flags_challenge_flag_key
    ON gt.gt_flags (challenge_version_id, flag_key);
