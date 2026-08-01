CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('viewer','operator','administrator','owner')),
  plex_account_id TEXT NOT NULL UNIQUE,
  verified_email TEXT NOT NULL,
  plex_username TEXT NOT NULL,
  plex_title TEXT,
  avatar_url TEXT,
  has_plex_pass INTEGER NOT NULL CHECK(has_plex_pass IN (0,1)),
  token_reference TEXT NOT NULL,
  media_server_scopes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX identities_single_owner ON identities(role) WHERE role='owner';
