-- Query-only documented prices; account reads cost zero but still use budgets/receipts.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note) VALUES
 ('redfox.query','ABJQXHUE','CNY',0.06,'https://redfox.hk/apis/X(Twitter)/ABJQXHUE','2026-10-20','Published base price; estimated, not an actual supplier debit.'),
 ('redfox.query','5K5EG87P','CNY',0.06,'https://redfox.hk/apis/X(Twitter)/5K5EG87P','2026-10-20','Published base price; estimated, not an actual supplier debit.'),
 ('redfox.query','API_1790063277084','CNY',0.06,'https://redfox.hk/apis/X(Twitter)/API_1790063277084','2026-10-20','Published base price; estimated, not an actual supplier debit.'),
 ('redfox.query','5QY3G5TY','CNY',0.06,'https://redfox.hk/apis/X(Twitter)/5QY3G5TY','2026-10-20','Published base price; estimated, not an actual supplier debit.'),
 ('redfox.query','9Y4EX7RW','CNY',0.06,'https://redfox.hk/apis/all/9Y4EX7RW','2026-10-20','Published base price; estimated, not an actual supplier debit.'),
 ('redfox.query','W94P1QH1','CNY',0.06,'https://redfox.hk/apis/all/W94P1QH1','2026-10-20','Published base price; estimated, not an actual supplier debit.'),
 ('redfox.query','S28Q6HUD','CNY',0.06,'https://redfox.hk/apis/all/S28Q6HUD','2026-10-20','Published base price; estimated, not an actual supplier debit.'),
 ('redfox.query','API_1792036841619','CNY',0,'https://redfox.hk/apis/redfox/API_1792036841619','2026-10-20','Published base price; estimated, not an actual supplier debit.'),
 ('redfox.query','API_1792043329817','CNY',0,'https://redfox.hk/apis/redfox/API_1792043329817','2026-10-20','Published base price; estimated, not an actual supplier debit.')
ON CONFLICT(service,model) DO NOTHING;
