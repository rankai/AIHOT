-- Public documentation checked 2026-10-27; estimates, not actual charges.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT service,model,'CNY',0.06,'https://redfox.hk/story/web/api/doc/detail/no/'||model,DATE '2026-10-27',
 'Documented base estimate per request; account availability and actual charges not verified.'
FROM (VALUES
 ('redfox.query','API_1792651427872'),('redfox.query','API_1792651427970'),
 ('redfox.query','API_1792651512423'),('redfox.query','API_1792651658984'),
 ('redfox.collect','API_1792651427872'),('redfox.collect','API_1792651427970')
) AS prices(service,model)
ON CONFLICT(service,model) DO NOTHING;
