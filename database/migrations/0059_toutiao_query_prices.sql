-- Published query base prices in CNY; estimates, not observed supplier debits.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.query',operation,'CNY',0.06,
 'https://redfox.hk/apis/jinritoutiao/'||operation,'2026-10-20',
 'Published base price; estimated, not an observed debit or discounted minimum.'
FROM unnest(ARRAY['28CFGF5I','PAB6Z75Y','4QS1F8DE','R1IGR09H']) AS operation
ON CONFLICT(service,model) DO NOTHING;
