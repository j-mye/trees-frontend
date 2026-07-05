-- Run in BigQuery (mke_tree_dataset.users). Backfills existing rows as approved.
-- After this migration, set ACCESS_REQUIRE_APPROVAL=true on Cloud Functions.

ALTER TABLE `mke-trees.mke_tree_dataset.users`
  ADD COLUMN IF NOT EXISTS tier STRING,
  ADD COLUMN IF NOT EXISTS approval_status STRING,
  ADD COLUMN IF NOT EXISTS display_name STRING,
  ADD COLUMN IF NOT EXISTS organization STRING,
  ADD COLUMN IF NOT EXISTS access_note STRING,
  ADD COLUMN IF NOT EXISTS rejection_reason STRING,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS approved_by STRING;

UPDATE `mke-trees.mke_tree_dataset.users`
SET
  tier = COALESCE(tier, 'standard'),
  approval_status = COALESCE(approval_status, 'approved'),
  active = COALESCE(active, TRUE)
WHERE TRUE;
