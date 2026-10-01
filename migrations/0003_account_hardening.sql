PRAGMA foreign_keys = ON;

-- Adds replay protection for authenticator-app TOTP codes and makes
-- the login challenge table explicit instead of creating it at request time.
ALTER TABLE users ADD COLUMN two_factor_last_step INTEGER;

CREATE TABLE IF NOT EXISTS login_challenges (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_challenges_expiry ON login_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_tokens_lookup ON email_tokens(token_hash, kind, used_at, expires_at);
