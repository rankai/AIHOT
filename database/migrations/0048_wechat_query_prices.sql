-- Public snapshot base prices and confirmed site CNY units, 2026-10-20.
-- Only currently implemented query operations; estimates are not actual account debits.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.query',operation,'CNY',
  CASE WHEN operation IN ('I3CIBRI2','DL4YNCTQ','JBGBKQ4B') THEN 0.06 ELSE 0.04 END,
  'https://redfox.hk/apis/gongzhonghao/'||operation,'2026-10-20',
  'Published base price; estimated, not an observed debit or discounted minimum.'
FROM unnest(ARRAY['6C4A77XR','KUQYSQNX','XEO0QQNF','1LDQ7E1C','DNVPQZEZ','5Y84NI1D','PW97QFBS','FVQ8D4W5','XNV30XZ3','8IQD0BJC','IE0887SO','I3CIBRI2','ZIGAGYYT','OFFSPQ0U','DL4YNCTQ','JBGBKQ4B','API_1789637464311']) AS operation
ON CONFLICT(service,model) DO NOTHING;
