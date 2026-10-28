-- Public documentation checked 2026-10-27; estimates, not actual charges.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT service,model,'CNY',price,'https://redfox.hk/story/web/api/doc/detail/no/'||model,DATE '2026-10-27',
 'Documented product-search base estimate; actual charges not verified. Free polls still consume request budgets.'
FROM (VALUES
 ('redfox.ai_search','API_1793002507495',0.12),('redfox.poll','API_1793002507566',0),
 ('redfox.ai_search','API_1793002507670',0.12),('redfox.poll','API_1793002507727',0)
) AS prices(service,model,price)
ON CONFLICT(service,model) DO NOTHING;
