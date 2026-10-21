-- Official list prices; public CNY evidence verified 2026-10-20. Estimates, not debits.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.query',operation,'CNY',
  CASE WHEN operation IN ('20060016','3X8FGEEM','LBYLC5AK','AEA6YE0J') THEN 0.06 ELSE 0.04 END,
  'https://redfox.hk/apis/xiaohongshu/'||operation,'2026-10-20',
  'Published base price; estimated, not an observed debit or discounted minimum.'
FROM unnest(ARRAY['20060016','4IVIDHEN','KR1LPTBF','439NFLBD','384C6W6B','047JJ3UA','3X8FGEEM','LBYLC5AK','XN3ULENA','P3W2W18P','AEA6YE0J']) AS operation
ON CONFLICT(service,model) DO NOTHING;
