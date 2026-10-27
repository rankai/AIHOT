-- Fixed configured collection detail estimates; no actual-charge claim or query-budget fallback.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.collect',model,currency,per_request,source_url,verified_on,
 'Documented collection detail estimate, not actual cost. ' || COALESCE(note,'')
FROM service_prices WHERE service='redfox.query' AND model IN (
 '0OT1E306','FK67XDVQ','KR1LPTBF','XEO0QQNF','1LDQ7E1C','I3CIBRI2','6SE9WIHJ','TIN1NMTZ',
 'API_1789098514899','TE6AGWAF','LLCI8QTE','QQ5E3EZ9','3BXWEB6Y','VYSP68M2')
ON CONFLICT(service,model) DO NOTHING;
