-- Six synchronous comment/following research queries only. Published base prices are estimates.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note) VALUES
 ('redfox.query','ZMFVK589','CNY',0.06,'https://redfox.hk/apis/jinritoutiao/ZMFVK589','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.query','API_1790577699794','CNY',0.06,'https://redfox.hk/apis/tool-tiktok/API_1790577699794','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.query','API_1790581645603','CNY',0.06,'https://redfox.hk/apis/tool-tiktok/API_1790581645603','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.query','API_1791446025175','CNY',0.06,'https://redfox.hk/apis/tool-tiktok/API_1791446025175','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.query','WULKP6JP','CNY',0.06,'https://redfox.hk/apis/Youtube/WULKP6JP','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.query','U1SGKF2G','CNY',0.06,'https://redfox.hk/apis/Instagram/U1SGKF2G','2026-10-20','Published base price; estimated per request, not an actual supplier debit.')
ON CONFLICT(service,model) DO NOTHING;
