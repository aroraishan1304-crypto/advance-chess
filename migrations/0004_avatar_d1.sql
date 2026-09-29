PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN avatar_mime TEXT;
ALTER TABLE users ADD COLUMN avatar_data BLOB;

CREATE INDEX IF NOT EXISTS idx_users_avatar
ON users(avatar_key)
WHERE avatar_key IS NOT NULL;
