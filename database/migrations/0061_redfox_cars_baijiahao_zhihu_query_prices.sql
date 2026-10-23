-- Documented query base prices; CNY public-site evidence, not actual debits.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note) VALUES
 ('redfox.query','CI7VW144','CNY',0.06,'https://redfox.hk/apis/qichezhijia/CI7VW144','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','LLCI8QTE','CNY',0.06,'https://redfox.hk/apis/qichezhijia/LLCI8QTE','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','TE6AGWAF','CNY',0.06,'https://redfox.hk/apis/qichezhijia/TE6AGWAF','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','4BOZ9DLE','CNY',0.06,'https://redfox.hk/apis/qichezhijia/4BOZ9DLE','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','W86F8SSK','CNY',0.06,'https://redfox.hk/apis/dongchedi/W86F8SSK','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','QQ5E3EZ9','CNY',0.06,'https://redfox.hk/apis/dongchedi/QQ5E3EZ9','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','X16I71WV','CNY',0.06,'https://redfox.hk/apis/dongchedi/X16I71WV','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','API_1791793668086','CNY',0.06,'https://redfox.hk/apis/dongchedi/API_1791793668086','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','3BXWEB6Y','CNY',0.06,'https://redfox.hk/apis/yiche/3BXWEB6Y','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','9KFOB9M2','CNY',0.06,'https://redfox.hk/apis/yiche/9KFOB9M2','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','YGYYT0G0','CNY',0.06,'https://redfox.hk/apis/yiche/YGYYT0G0','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','YIGCY5US','CNY',0.06,'https://redfox.hk/apis/yiche/YIGCY5US','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','VYSP68M2','CNY',0.06,'https://redfox.hk/apis/yiche/VYSP68M2','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','API_1789097000710','CNY',0.06,'https://redfox.hk/apis/baijiahao/API_1789097000710','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','API_1789097000761','CNY',0.06,'https://redfox.hk/apis/baijiahao/API_1789097000761','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','API_1789097000814','CNY',0.06,'https://redfox.hk/apis/baijiahao/API_1789097000814','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','API_1789097000858','CNY',0.06,'https://redfox.hk/apis/baijiahao/API_1789097000858','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','API_1789097000885','CNY',0.06,'https://redfox.hk/apis/baijiahao/API_1789097000885','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.'),
 ('redfox.query','API_1789095347662','CNY',0.06,'https://redfox.hk/apis/zhihu/API_1789095347662','2026-10-20','Published base price; estimated, not an observed debit or discounted minimum.')
ON CONFLICT(service,model) DO NOTHING;
