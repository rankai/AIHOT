-- Published query base prices in CNY; estimates, not observed supplier debits.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.query',operation,'CNY',0.04,
 'https://redfox.hk/apis/kuaishou/'||operation,'2026-10-20',
 'Published base price; estimated, not an observed debit or discounted minimum.'
FROM unnest(ARRAY['GU17EVLV','27DQ6SF9','UOM99OQI','ZWR31P2A']) AS operation
ON CONFLICT(service,model) DO NOTHING;
