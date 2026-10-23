-- Account reads belong to the approved redfox.account purpose; retain historical receipts unchanged.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.account',model,currency,per_request,source_url,verified_on,note
FROM service_prices WHERE service='redfox.query' AND model IN ('API_1792036841619','API_1792043329817')
ON CONFLICT(service,model) DO NOTHING;
DELETE FROM service_prices WHERE service='redfox.query' AND model IN ('API_1792036841619','API_1792043329817');
