-- One wallet reservation per task. Items explain allocation; they are not a second ledger.
CREATE TABLE member_credit_task_items (
  charge_id uuid NOT NULL REFERENCES member_credit_charges(id),
  item_key text NOT NULL,
  unit integer NOT NULL CHECK (unit > 0 AND unit <= 20),
  pricing_snapshot jsonb NOT NULL,
  intent jsonb NOT NULL,
  amount bigint NOT NULL CHECK (amount BETWEEN 0 AND 1000000000),
  run_id bigint UNIQUE REFERENCES operation_runs(id),
  recovery_run_id bigint UNIQUE REFERENCES operation_runs(id),
  consumed bigint CHECK (consumed >= 0 AND consumed <= amount),
  evidence jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (charge_id, item_key, unit),
  CHECK (recovery_run_id IS NULL OR run_id IS NOT NULL)
);
-- Unified read-only authorization boundary; legacy links retain their original constraints.
CREATE VIEW member_credit_authorized_runs AS
  SELECT charge_id, run_id FROM member_credit_run_links
  UNION SELECT charge_id, run_id FROM member_credit_task_items WHERE run_id IS NOT NULL
  UNION SELECT charge_id, recovery_run_id FROM member_credit_task_items WHERE recovery_run_id IS NOT NULL;
