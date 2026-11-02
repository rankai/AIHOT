-- Recovery snapshot intentionally has no quote FK: expired unused quotes are pruned.
ALTER TABLE assistant_sessions ADD COLUMN initial_request jsonb;
