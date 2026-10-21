-- Fixed X search collection documented base estimate; not actual supplier charges.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.collect',model,currency,per_request,source_url,verified_on,
 'Documented collection estimate, not actual cost. ' || COALESCE(note,'')
FROM service_prices WHERE service='redfox.query' AND model='5K5EG87P'
ON CONFLICT(service,model) DO NOTHING;
