-- Documented base estimates for these fixed collection reads, not supplier actual charges.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.collect',model,currency,per_request,source_url,verified_on,
 'Documented base estimate for collection; not actual cost. ' || COALESCE(note,'')
FROM service_prices WHERE service='redfox.query' AND model IN (
 'PW97QFBS','FVQ8D4W5','IE0887SO','ZIGAGYYT','OFFSPQ0U','DL4YNCTQ','R473NUE9','PXZXY8KQ','API_1790149158205','API_1790581450500','LEN9QXR3','VPA67I98','28CFGF5I','R1IGR09H','E7G00COY','OVUTOTCV','27DQ6SF9','ZWR31P2A','GC5SC5HS','GM0TISWI')
ON CONFLICT(service,model) DO NOTHING;
