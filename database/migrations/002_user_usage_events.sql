-- Portal usage events for admin analytics (tool popularity, power users).
-- Run in BigQuery dataset mke_tree_dataset before enabling usage tracking.

CREATE TABLE IF NOT EXISTS `mke-trees.mke_tree_dataset.user_usage_events` (
  event_id STRING NOT NULL,
  user_id STRING NOT NULL,
  email STRING,
  tool STRING NOT NULL,
  event_type STRING NOT NULL,
  action_name STRING,
  path STRING,
  occurred_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(occurred_at)
CLUSTER BY user_id, tool;
