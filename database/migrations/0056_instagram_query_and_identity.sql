-- Published base prices in CNY, estimates rather than observed debits.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.query',operation,'CNY',0.06,
 'https://redfox.hk/apis/Instagram/'||operation,'2026-10-20',
 'Published base price; estimated, not an observed debit or discounted minimum.'
FROM unnest(ARRAY['GM0TISWI','3YJT69FL','Z9M88QI8']) AS operation
ON CONFLICT(service,model) DO NOTHING;
-- May be prebuilt with the same name CONCURRENTLY in a separately authorized
-- deployment window. Covers only legacy generic native originals, not custom keys.
CREATE INDEX IF NOT EXISTS articles_instagram_legacy_identity_idx ON articles(identity_key text_pattern_ops)
WHERE (identity_key LIKE 'url:https://instagram.com/p/%' OR identity_key LIKE 'url:https://instagram.com/reel/%')
 AND identity_key NOT LIKE '%#%';
