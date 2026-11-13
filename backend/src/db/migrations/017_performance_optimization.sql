-- Migration 017: Performance optimization and query acceleration indexes

-- Index for daily active users (DAU) aggregation over activity_date ranges
CREATE INDEX IF NOT EXISTS learner_activity_date_idx ON learner_activity(activity_date, user_id);

-- Index for time-range AI usage metrics and token telemetry queries
CREATE INDEX IF NOT EXISTS ai_provider_usage_recorded_idx ON ai_provider_usage(recorded_at DESC);

-- Composite index for platform revenue and payment ledger queries
CREATE INDEX IF NOT EXISTS synthetic_payments_status_created_idx ON synthetic_payments(status, created_at);

-- Composite index for moderation queue and flagged discussion posts
CREATE INDEX IF NOT EXISTS discussion_posts_moderation_idx ON discussion_posts(visibility, is_flagged, created_at DESC);

