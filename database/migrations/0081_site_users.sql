-- Reader accounts have no relationship to admin_users or administrative sessions.
CREATE TABLE site_users (
  id bigserial PRIMARY KEY,
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role = 'member'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE site_sessions (
  id_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX site_sessions_user_idx ON site_sessions(user_id);
CREATE INDEX site_sessions_expiry_idx ON site_sessions(expires_at);
