-- Configuration entry only: visual research stays closed until an administrator sets budgets.
INSERT INTO budgets(service,per_minute,per_hour,per_day)
 VALUES ('assistant.vision',0,0,0) ON CONFLICT(service) DO NOTHING;
INSERT INTO budget_scopes(service,scope)
 SELECT service,scope FROM budgets CROSS JOIN (VALUES ('member'),('admin')) AS scopes(scope)
 WHERE service='assistant.vision' ON CONFLICT(service,scope) DO NOTHING;
