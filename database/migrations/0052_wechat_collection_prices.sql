-- Documented base CNY estimates, not observed debits. Same-library list and detail only.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.collect',operation,'CNY',0.04,'https://redfox.hk/apis/gongzhonghao/'||operation,'2026-10-20',
  'Published base price; estimated, not an observed debit or discounted minimum.'
FROM unnest(ARRAY['8IQD0BJC','1LDQ7E1C','XNV30XZ3','XEO0QQNF']) AS operation
ON CONFLICT(service,model) DO NOTHING;
