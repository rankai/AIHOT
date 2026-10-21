-- Published query base prices in CNY; estimated, not observed supplier debits.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
SELECT 'redfox.query',operation,'CNY',price,
 'https://redfox.hk/apis/shipinhao/'||operation,'2026-10-20',
 'Published base price; estimated, not an observed debit or discounted minimum.'
FROM (VALUES ('E7G00COY',0.04),('NL4I3533',0.04),('OE4KUEUO',0.04),('OVUTOTCV',0.04),('MH5YA9DL',0.06)) AS prices(operation,price)
ON CONFLICT(service,model) DO NOTHING;
