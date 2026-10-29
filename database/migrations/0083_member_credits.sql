-- Expand only: private member credits do not change administrator/provider budgets.
-- No initial credits or tool prices are seeded; every grant and price is explicit.
CREATE TABLE member_credit_accounts (
  user_id bigint PRIMARY KEY REFERENCES site_users(id),
  available bigint NOT NULL DEFAULT 0 CHECK (available BETWEEN 0 AND 1000000000000),
  reserved bigint NOT NULL DEFAULT 0 CHECK (reserved BETWEEN 0 AND 1000000000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE member_tool_prices (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL DEFAULT '',
  tier text NOT NULL DEFAULT '',
  parameter_match jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(parameter_match) = 'object'),
  base_credits bigint NOT NULL CHECK (base_credits BETWEEN 0 AND 1000000000),
  image_credits bigint NOT NULL CHECK (image_credits BETWEEN 0 AND 1000000000),
  video_second_credits bigint NOT NULL CHECK (video_second_credits BETWEEN 0 AND 1000000000),
  reference_credits bigint NOT NULL CHECK (reference_credits BETWEEN 0 AND 1000000000),
  enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind, provider, model, tier, parameter_match)
);

CREATE TABLE member_tool_quotes (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES site_users(id),
  price_id uuid REFERENCES member_tool_prices(id),
  price_version integer NOT NULL,
  input_hash text NOT NULL,
  amount bigint NOT NULL CHECK (amount BETWEEN 0 AND 1000000000),
  pricing_snapshot jsonb NOT NULL,
  recovery_run_id bigint REFERENCES operation_runs(id),
  consumed_run_id bigint UNIQUE REFERENCES operation_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX member_tool_quotes_expiry_idx ON member_tool_quotes(expires_at) WHERE consumed_run_id IS NULL;

CREATE TABLE member_credit_charges (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES site_users(id),
  root_run_id bigint NOT NULL UNIQUE REFERENCES operation_runs(id),
  quote_id uuid NOT NULL UNIQUE REFERENCES member_tool_quotes(id),
  amount bigint NOT NULL CHECK (amount BETWEEN 0 AND 1000000000),
  consumed bigint NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  released bigint NOT NULL DEFAULT 0 CHECK (released >= 0),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','review','settled','released')),
  pricing_snapshot jsonb NOT NULL,
  review_reason text,
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (consumed + released <= amount),
  CHECK ((state IN ('reserved','review') AND consumed = 0 AND released = 0)
    OR (state IN ('settled','released') AND consumed + released = amount))
);
CREATE INDEX member_credit_charges_user_idx ON member_credit_charges(user_id, created_at DESC, id DESC);
CREATE INDEX member_credit_charges_review_idx ON member_credit_charges(created_at DESC, id DESC) WHERE state IN ('reserved','review');

CREATE TABLE member_credit_run_links (
  run_id bigint PRIMARY KEY REFERENCES operation_runs(id),
  charge_id uuid NOT NULL REFERENCES member_credit_charges(id),
  recovery boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX member_credit_run_links_root_idx ON member_credit_run_links(charge_id) WHERE NOT recovery;
CREATE UNIQUE INDEX member_credit_run_links_recovery_idx ON member_credit_run_links(charge_id) WHERE recovery;

CREATE TABLE member_credit_entries (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES site_users(id),
  kind text NOT NULL CHECK (kind IN ('grant','adjustment','reserve','consume','release')),
  amount bigint NOT NULL,
  available_delta bigint NOT NULL,
  reserved_delta bigint NOT NULL,
  available_after bigint NOT NULL CHECK (available_after BETWEEN 0 AND 1000000000000),
  reserved_after bigint NOT NULL CHECK (reserved_after BETWEEN 0 AND 1000000000000),
  charge_id uuid REFERENCES member_credit_charges(id),
  run_id bigint REFERENCES operation_runs(id),
  actor text NOT NULL,
  command_key text NOT NULL,
  input_hash text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor, command_key)
);
CREATE INDEX member_credit_entries_user_idx ON member_credit_entries(user_id, id DESC);

CREATE TABLE member_credit_reconciliations (
  actor text NOT NULL,
  command_key text NOT NULL,
  input_hash text NOT NULL,
  charge_id uuid NOT NULL REFERENCES member_credit_charges(id),
  consumed bigint NOT NULL CHECK (consumed >= 0),
  released bigint NOT NULL CHECK (released >= 0),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor, command_key)
);

CREATE FUNCTION prevent_member_credit_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Member credit history is append-only';
END;
$$;
CREATE TRIGGER member_credit_entries_immutable BEFORE UPDATE OR DELETE ON member_credit_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_member_credit_history_change();
CREATE TRIGGER member_credit_reconciliations_immutable BEFORE UPDATE OR DELETE ON member_credit_reconciliations
  FOR EACH ROW EXECUTE FUNCTION prevent_member_credit_history_change();
