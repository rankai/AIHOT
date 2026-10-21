-- Fixed documented collection base estimates; not actual supplier charges.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.collect',model,currency,per_request,source_url,verified_on,
 'Documented collection estimate, not actual cost. ' || COALESCE(note,'')
FROM service_prices WHERE service='redfox.query' AND model IN ('CI7VW144','4BOZ9DLE','W86F8SSK','API_1791793668086','YIGCY5US','YGYYT0G0','API_1789097000858','API_1789095347662')
ON CONFLICT(service,model) DO NOTHING;
