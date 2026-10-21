-- Official list prices, public CNY unit evidence verified 2026-10-20.
-- Estimates only, not account debits or discounted minimum prices.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.query',operation,'CNY',
  CASE WHEN operation IN ('20060017','HUCIASU') THEN 0.06 ELSE 0.04 END,
  'https://redfox.hk/apis/douyin/'||operation,'2026-10-20',
  'Published base price; estimated, not an observed debit or discounted minimum.'
FROM unnest(ARRAY['P5CHB3BZ','L6OUNUN1','QEQLCKD6','QSL2ZSXM','774OBKK0','OWIBYU1V','0OT1E306','FK67XDVQ','20060017','HUCIASU','XUT4CECZ','I8P3HTVH','WD6UT8DQ','0ZB9S2FW']) AS operation
ON CONFLICT(service,model) DO NOTHING;
