-- Official list price, CNY, verified 2026-10-20; an estimate, not an observed debit.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.query',operation,'CNY',0.06,
  'https://redfox.hk/apis/tool-tiktok/'||operation,'2026-10-20',
  'Published base price; estimated, not an observed debit or discounted minimum.'
FROM unnest(ARRAY['6SE9WIHJ','R473NUE9','PXZXY8KQ','VBBTYLMV','API_1790149158205','API_1790581450500','API_1790149281139']) AS operation
ON CONFLICT(service,model) DO NOTHING;

-- Only canonical generic video permalinks: handle and sharing query are mutable locators.
-- On a large existing database this exact named index can be prebuilt CONCURRENTLY
-- outside the migration transaction during a separately authorized deployment window.
CREATE INDEX IF NOT EXISTS articles_tiktok_legacy_identity_idx ON articles
  ((substring(identity_key from '^url:https://tiktok[.]com/@[A-Za-z0-9_.-]+/video/([0-9]+)/?([?][^#]*)?$')))
WHERE identity_key ~ '^url:https://tiktok[.]com/@[A-Za-z0-9_.-]+/video/[0-9]+/?([?][^#]*)?$';
