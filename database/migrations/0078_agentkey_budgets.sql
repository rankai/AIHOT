-- Counts, not monetary limits. AgentKey dispatch requires explicit budget approval.
INSERT INTO budgets(service, per_minute, per_hour, per_day)
VALUES ('agentkey.collect', 0, 0, 0), ('agentkey.query', 0, 0, 0)
ON CONFLICT(service) DO NOTHING;
