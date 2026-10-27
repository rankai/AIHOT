-- Lifecycle only; native collection cutover and historical backfill are separate operations.
ALTER TABLE sources ADD COLUMN execution_version integer NOT NULL DEFAULT 1 CHECK (execution_version > 0);

CREATE TABLE collection_subscriptions (
  id bigserial PRIMARY KEY,
  control_source_id text UNIQUE REFERENCES sources(id),
  provider text NOT NULL,
  platform text NOT NULL,
  operation_key text NOT NULL,
  contract_version integer NOT NULL CHECK (contract_version > 0),
  config jsonb NOT NULL DEFAULT '{}',
  execution_version integer NOT NULL DEFAULT 1 CHECK (execution_version > 0),
  edit_version integer NOT NULL DEFAULT 1 CHECK (edit_version > 0),
  enabled boolean NOT NULL DEFAULT false,
  interval_minutes integer NOT NULL CHECK (interval_minutes > 0),
  limits jsonb NOT NULL DEFAULT '{}',
  progress jsonb NOT NULL DEFAULT '{}',
  next_run_at timestamptz,
  active_run_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collection_subscriptions_due_idx ON collection_subscriptions(next_run_at) WHERE enabled AND active_run_id IS NULL;

CREATE TABLE operation_runs (
  id bigserial PRIMARY KEY,
  actor text NOT NULL,
  command_key text NOT NULL,
  subscription_id bigint REFERENCES collection_subscriptions(id),
  provider text NOT NULL,
  operation_key text NOT NULL,
  contract_version integer NOT NULL CHECK (contract_version > 0),
  input jsonb NOT NULL,
  input_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','waiting','needs_review','stopped','completed','failed')),
  step_key text NOT NULL,
  step_version integer NOT NULL DEFAULT 1 CHECK (step_version > 0),
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  progress jsonb NOT NULL DEFAULT '{}',
  current_receipt_id bigint REFERENCES receipts(id),
  wait_reason text,
  next_attempt_at timestamptz,
  job_id uuid,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  limits jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor, command_key)
);
ALTER TABLE collection_subscriptions ADD CONSTRAINT collection_subscriptions_active_run_fk FOREIGN KEY (active_run_id) REFERENCES operation_runs(id);
CREATE INDEX operation_runs_receipt_idx ON operation_runs(current_receipt_id) WHERE current_receipt_id IS NOT NULL;
CREATE INDEX operation_runs_due_idx ON operation_runs(next_attempt_at) WHERE status IN ('active','waiting');

CREATE TABLE operation_results (
  id bigserial PRIMARY KEY,
  run_id bigint NOT NULL REFERENCES operation_runs(id),
  step_version integer NOT NULL,
  item_key text NOT NULL,
  kind text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  receipt_id bigint REFERENCES receipts(id),
  provenance jsonb NOT NULL DEFAULT '{}',
  article_id text REFERENCES articles(id),
  source_id text REFERENCES sources(id),
  file_key text REFERENCES stored_files(key),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, step_version, item_key)
);
CREATE INDEX operation_results_receipt_idx ON operation_results(receipt_id) WHERE receipt_id IS NOT NULL;

CREATE TABLE source_account_bindings (
  platform text NOT NULL,
  id_kind text NOT NULL,
  id_value text NOT NULL,
  source_id text NOT NULL REFERENCES sources(id),
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(platform, id_kind, id_value)
);
CREATE INDEX source_account_bindings_source_idx ON source_account_bindings(source_id);
