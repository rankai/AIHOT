-- Existing files remain administrator-only unless a member-owned result references them.
-- Worker outputs inherit their run's ownership through operation_results.
ALTER TABLE stored_files ADD COLUMN owner_actor text;
CREATE INDEX stored_files_owner_key_idx ON stored_files(owner_actor, key) WHERE owner_actor IS NOT NULL;
CREATE INDEX operation_runs_actor_id_idx ON operation_runs(actor, id DESC);
CREATE INDEX operation_results_file_owner_idx ON operation_results(file_key, run_id) WHERE file_key IS NOT NULL;
