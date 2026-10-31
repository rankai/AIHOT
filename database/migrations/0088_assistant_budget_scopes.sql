-- Assistant member calls share the trusted operation budget scope. Keep both pools closed.
INSERT INTO budget_scopes(service,scope)
 SELECT service,scope FROM budgets CROSS JOIN (VALUES ('member'),('admin')) AS scopes(scope)
 WHERE service='assistant.text'
 ON CONFLICT(service,scope) DO NOTHING;
