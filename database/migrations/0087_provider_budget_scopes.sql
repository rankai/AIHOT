-- Existing budgets remain the total cap. Neither child pool is enabled by this migration.
CREATE TABLE budget_scopes (
 service text NOT NULL REFERENCES budgets(service),
 scope text NOT NULL CHECK (scope IN ('member','admin')),
 per_minute integer NOT NULL DEFAULT 0 CHECK (per_minute >= 0),
 per_hour integer NOT NULL DEFAULT 0 CHECK (per_hour >= 0),
 per_day integer NOT NULL DEFAULT 0 CHECK (per_day >= 0),
 note text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(service,scope)
);
INSERT INTO budget_scopes(service,scope)
 SELECT service,scope FROM budgets CROSS JOIN (VALUES ('member'),('admin')) AS scopes(scope) WHERE service LIKE 'redfox.%' OR service LIKE 'agentkey.%' OR service LIKE 'aliyun.wan.%';
ALTER TABLE receipt_attempts ADD COLUMN budget_scope text CHECK (budget_scope IN ('member','admin'));
CREATE INDEX receipt_attempts_scope_budget_idx ON receipt_attempts(service,budget_scope,started_at) WHERE origin='live';
