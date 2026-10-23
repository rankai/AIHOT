-- Explicitly disabled until an operator configures request limits. Missing Redfox budgets also deny dispatch.
INSERT INTO budgets(service, per_minute, per_hour, per_day)
SELECT 'redfox.' || purpose, 0, 0, 0
FROM unnest(ARRAY['collect','query','transcript','ai_search','image','video','media','poll','account']) AS purpose
ON CONFLICT (service) DO NOTHING;

-- Published list prices, not discounted quotes or observed debits.
INSERT INTO service_prices(service, model, currency, per_request, source_url, verified_on, note)
SELECT service, operation, 'CNY', 0.06, 'https://redfox.hk/apis/X(Twitter)/' || operation, '2026-10-20',
  'Published per-request list price; estimated, not an actual debit.'
FROM unnest(ARRAY['redfox.query','redfox.collect']) AS service
CROSS JOIN unnest(ARRAY['AKFHJMXQ','API_1790148502632','QCP75W33']) AS operation
ON CONFLICT (service, model) DO NOTHING;
