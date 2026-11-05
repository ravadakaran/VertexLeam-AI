ALTER TABLE playback_events ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS playback_events_created_idx ON playback_events(created_at);
