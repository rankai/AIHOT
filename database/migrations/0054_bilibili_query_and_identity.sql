-- Official published list price, CNY, verified 2026-10-20; estimates, not debits.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.query',operation,'CNY',0.04,
  'https://redfox.hk/apis/bilibili/'||operation,'2026-10-20',
  'Published base price; estimated, not an observed debit or discounted minimum.'
FROM unnest(ARRAY['TIN1NMTZ','EH53TOT7','ZXJLJQ21','LEN9QXR3','VPA67I98']) AS operation
ON CONFLICT(service,model) DO NOTHING;
-- Legacy canonical native BV addresses may carry varying query parameters.
-- For a large database this same named index can be prebuilt CONCURRENTLY in a
-- separately authorized deployment window, outside this migration transaction.
CREATE INDEX IF NOT EXISTS articles_bilibili_legacy_identity_idx ON articles (identity_key text_pattern_ops)
WHERE identity_key LIKE 'url:https://bilibili.com/video/BV%' AND identity_key NOT LIKE '%#%';
