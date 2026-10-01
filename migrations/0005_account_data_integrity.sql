PRAGMA foreign_keys = ON;

-- Keep migrated guest rows briefly so in-flight Durable Object games can still
-- resolve their original guest identity after account creation.
ALTER TABLE guest_accounts ADD COLUMN migrated_to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE guest_accounts ADD COLUMN migrated_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_guest_migrated ON guest_accounts(migrated_to_user_id, migrated_at);

-- Idempotency key for puzzle result submissions. NULL remains valid for legacy rows.
ALTER TABLE puzzle_rating_history ADD COLUMN attempt_id TEXT;
ALTER TABLE puzzle_rating_history ADD COLUMN puzzle_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_puzzle_history_attempt ON puzzle_rating_history(user_id, attempt_id) WHERE attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puzzle_history_puzzle ON puzzle_rating_history(user_id, puzzle_id, created_at DESC);
