-- Official per-interface CNY units verified 2026-10-20; public metadata list price,
-- not the advertised minimum/discount or an observed account debit.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT service,operation,'CNY',0.06,'https://redfox.hk/apis/weibo/'||operation,'2026-10-20',
  'Published base price; estimated, not an actual debit or minimum discounted price.'
FROM unnest(ARRAY['redfox.query','redfox.collect']) AS service
CROSS JOIN unnest(ARRAY['API_1789098514899','API_1789098515117','API_1789098515245','TXQPVGJG','UAQ90A1F']) AS operation
ON CONFLICT(service,model) DO NOTHING;
