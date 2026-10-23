-- Fixed documented hotspot snapshot estimates; not actual supplier charges.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.collect',model,currency,per_request,source_url,verified_on,
 'Documented collection estimate, not actual cost. ' || COALESCE(note,'')
FROM service_prices WHERE service='redfox.query' AND model IN ('9Y4EX7RW','W94P1QH1','S28Q6HUD')
ON CONFLICT(service,model) DO NOTHING;
