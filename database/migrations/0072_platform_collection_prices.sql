-- The same documented fixed read operations, now used by bounded collection.
-- Copy verified document estimates only; these are not observed supplier debits.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.collect',model,currency,per_request,source_url,verified_on,
 'Documented base estimate for collection; not actual cost. ' || COALESCE(note,'')
FROM service_prices WHERE service='redfox.query' AND model IN (
 'QEQLCKD6','QSL2ZSXM','774OBKK0','OWIBYU1V','HUCIASU','I8P3HTVH','WD6UT8DQ','0ZB9S2FW',
 '384C6W6B','047JJ3UA','3X8FGEEM','LBYLC5AK','XN3ULENA','P3W2W18P','AEA6YE0J')
ON CONFLICT(service,model) DO NOTHING;
