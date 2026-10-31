-- Reporting identity and provenance for each paid outbound attempt. Existing receipt identity,
-- budget keys and cost fields keep their current meaning.
ALTER TABLE receipt_attempts
  ADD COLUMN billing_provider text,
  ADD COLUMN upstream_provider text,
  ADD COLUMN operation_id text,
  ADD COLUMN model_id text,
  ADD COLUMN environment text CHECK (environment IN ('production', 'development', 'test', 'other', 'unknown')),
  ADD COLUMN operation_run_id bigint REFERENCES operation_runs(id),
  ADD COLUMN owner_user_id bigint REFERENCES site_users(id),
  ADD COLUMN owner_kind text CHECK (owner_kind IN ('member', 'admin', 'system', 'unassigned')),
  ADD COLUMN price_snapshot jsonb,
  ADD CONSTRAINT receipt_attempts_owner_identity_check CHECK (
    (owner_kind IS NOT NULL AND owner_kind = 'member' AND owner_user_id IS NOT NULL)
    OR (owner_kind IS NOT NULL AND owner_kind IN ('admin', 'system', 'unassigned') AND owner_user_id IS NULL)
    OR (owner_kind IS NULL AND owner_user_id IS NULL)
  );

CREATE INDEX receipt_attempts_started_idx
  ON receipt_attempts (started_at DESC, id DESC);
CREATE INDEX receipt_attempts_provider_started_idx
  ON receipt_attempts (billing_provider, started_at DESC, id DESC);
CREATE INDEX receipt_attempts_owner_started_idx
  ON receipt_attempts (owner_user_id, started_at DESC, id DESC)
  WHERE owner_user_id IS NOT NULL;
CREATE INDEX receipt_attempts_operation_run_idx
  ON receipt_attempts (operation_run_id)
  WHERE operation_run_id IS NOT NULL;
CREATE INDEX receipt_attempts_wan_submission_idx
  ON receipt_attempts (
    (usage->'wanTask'->>'submissionReceiptId'),
    (usage->'wanTask'->>'submissionAttempt')
  )
  WHERE service = 'aliyun.wan.poll' AND usage ? 'wanTask';
CREATE INDEX receipt_attempts_wan_task_identity_idx
  ON receipt_attempts (
    (usage->'wanTask'->>'provider'),
    (usage->'wanTask'->'configIdentity'),
    (usage->'wanTask'->>'taskId')
  )
  WHERE service = 'aliyun.wan.poll' AND usage ? 'wanTask';

-- A model step can legitimately use more than one activated skill/module. This joins the step to
-- the exact activation set captured when its request was built.
ALTER TABLE assistant_model_steps
  ADD COLUMN cost_context_version smallint CHECK (cost_context_version IS NULL OR cost_context_version = 1);

CREATE TABLE assistant_model_step_activations (
  model_step_id uuid NOT NULL REFERENCES assistant_model_steps(id),
  activation_id uuid NOT NULL REFERENCES assistant_activations(id),
  PRIMARY KEY (model_step_id, activation_id)
);

CREATE INDEX assistant_model_step_activations_activation_idx
  ON assistant_model_step_activations (activation_id, model_step_id);
CREATE INDEX IF NOT EXISTS assistant_model_steps_receipt_idx
  ON assistant_model_steps (receipt_id)
  WHERE receipt_id IS NOT NULL;
