-- Official published list price, CNY, verified 2026-10-20; estimates, not debits.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.query',operation,'CNY',0.06,
  'https://redfox.hk/apis/youtube/'||operation,'2026-10-20',
  'Published base price; estimated, not an observed debit or discounted minimum.'
FROM unnest(ARRAY['GC5SC5HS','609DF2IR']) AS operation
ON CONFLICT(service,model) DO NOTHING;
-- Strict legacy watch identities: exactly one v parameter, no fragment/custom key.
-- For a large database the same named index can be prebuilt CONCURRENTLY in a
-- separately authorized deployment window, outside this migration transaction.
CREATE INDEX IF NOT EXISTS articles_youtube_legacy_identity_idx ON articles
  ((substring(identity_key from '[?&]v=([A-Za-z0-9_-]{11})(&|$)')))
WHERE identity_key LIKE 'url:https://youtube.com/watch?%' AND identity_key NOT LIKE '%#%'
  AND regexp_count(identity_key, '[?&]v(?=[=&]|$)') = 1
  AND substring(identity_key from '[?&]v=([A-Za-z0-9_-]{11})(&|$)') IS NOT NULL;
