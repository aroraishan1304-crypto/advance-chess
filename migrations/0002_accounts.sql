PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_norm TEXT NOT NULL UNIQUE,
  email TEXT,
  email_norm TEXT UNIQUE,
  display_name TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',
  country TEXT,
  timezone TEXT,
  avatar_key TEXT,
  profile_visibility TEXT NOT NULL DEFAULT 'public' CHECK (profile_visibility IN ('public','friends','private')),
  online_visibility INTEGER NOT NULL DEFAULT 1 CHECK (online_visibility IN (0,1)),
  friend_request_setting TEXT NOT NULL DEFAULT 'everyone' CHECK (friend_request_setting IN ('everyone','friends_of_friends','nobody')),
  challenge_setting TEXT NOT NULL DEFAULT 'everyone' CHECK (challenge_setting IN ('everyone','friends','nobody')),
  searchable INTEGER NOT NULL DEFAULT 1 CHECK (searchable IN (0,1)),
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0,1)),
  password_hash TEXT,
  password_salt TEXT,
  two_factor_enabled INTEGER NOT NULL DEFAULT 0 CHECK (two_factor_enabled IN (0,1)),
  two_factor_secret_enc TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_email_norm ON users(email_norm);
CREATE INDEX IF NOT EXISTS idx_users_search ON users(username_norm, searchable, status);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);

CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  provider_subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS idx_auth_identity_user ON auth_identities(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS email_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify_email','password_reset','email_change')),
  token_hash TEXT NOT NULL UNIQUE,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, kind);

CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('login','link')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_state_expiry ON oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS oauth_pending (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider = 'google'),
  provider_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_pending_expiry ON oauth_pending(expires_at);

CREATE TABLE IF NOT EXISTS guest_accounts (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_guest_last_seen ON guest_accounts(last_seen_at);

CREATE TABLE IF NOT EXISTS ratings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('bullet','blitz','rapid','classical','puzzle')),
  rating INTEGER NOT NULL DEFAULT 1200,
  deviation INTEGER NOT NULL DEFAULT 350,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, category)
);
CREATE INDEX IF NOT EXISTS idx_ratings_leaderboard ON ratings(category, rating DESC, games DESC);

CREATE TABLE IF NOT EXISTS rating_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('bullet','blitz','rapid','classical')),
  game_id TEXT,
  rating_before INTEGER NOT NULL,
  rating_after INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('win','draw','loss')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rating_history_user ON rating_history(user_id, category, created_at DESC);

CREATE TABLE IF NOT EXISTS puzzle_stats (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL DEFAULT 1200,
  games INTEGER NOT NULL DEFAULT 0,
  solves INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS puzzle_rating_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating_before INTEGER NOT NULL,
  rating_after INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  solved INTEGER NOT NULL CHECK (solved IN (0,1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_puzzle_history_user ON puzzle_rating_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  white_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  black_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  guest_white_id TEXT REFERENCES guest_accounts(id) ON DELETE SET NULL,
  guest_black_id TEXT REFERENCES guest_accounts(id) ON DELETE SET NULL,
  category TEXT CHECK (category IN ('bullet','blitz','rapid','classical')),
  time_control TEXT,
  rated INTEGER NOT NULL DEFAULT 0 CHECK (rated IN (0,1)),
  result TEXT CHECK (result IN ('white','black','draw','aborted','unfinished')),
  reason TEXT,
  pgn TEXT,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_category ON games(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_guest_white ON games(guest_white_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_guest_black ON games(guest_black_id, created_at DESC);

CREATE TABLE IF NOT EXISTS friendships (
  user_low TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_low, user_high)
);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time_control TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('bullet','blitz','rapid','classical')),
  rated INTEGER NOT NULL DEFAULT 0 CHECK (rated IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired','cancelled')),
  rematch_of TEXT REFERENCES challenges(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_recipient ON challenges(recipient_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_challenges_sender ON challenges(sender_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS badges (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  awarded_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, code)
);

CREATE TABLE IF NOT EXISTS two_factor_backup_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON two_factor_backup_codes(user_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  key_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(key_hash, window_start)
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('bullet','blitz','rapid','classical')),
  time_control TEXT NOT NULL,
  rated INTEGER NOT NULL DEFAULT 0 CHECK (rated IN (0,1)),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  max_players INTEGER NOT NULL DEFAULT 256,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','finished','cancelled')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status, starts_at);

CREATE TABLE IF NOT EXISTS tournament_entries (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(tournament_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_score ON tournament_entries(tournament_id, score DESC, wins DESC);

