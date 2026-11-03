-- Platform-funded preparation is disabled until an administrator sets an explicit budget.
INSERT INTO budgets(service,per_minute,per_hour,per_day)
VALUES ('assistant.quote-preparation',0,0,0) ON CONFLICT DO NOTHING;
