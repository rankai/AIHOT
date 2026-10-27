INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note) VALUES
 ('redfox.ai_search','USDIOVU24','CNY',0.18,'https://redfox.hk/apis/tool-ai-search/USDIOVU24','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.ai_search','USDIOVU23','CNY',0.06,'https://redfox.hk/apis/tool-ai-search/USDIOVU23','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.poll','IUAIUVB24','CNY',0,'https://redfox.hk/apis/tool-ai-search/IUAIUVB24','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.ai_search','O0DGBU8M','CNY',0.06,'https://redfox.hk/apis/tool-ai-search/O0DGBU8M','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.poll','PVQWHXGO','CNY',0,'https://redfox.hk/apis/tool-ai-search/PVQWHXGO','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.ai_search','3AFD5MIX','CNY',0.06,'https://redfox.hk/apis/tool-ai-search/3AFD5MIX','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.poll','QLG22Y7Y','CNY',0,'https://redfox.hk/apis/tool-ai-search/QLG22Y7Y','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.ai_search','UOTABJXI','CNY',0.06,'https://redfox.hk/apis/tool-ai-search/UOTABJXI','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.poll','T8BIOV6J','CNY',0,'https://redfox.hk/apis/tool-ai-search/T8BIOV6J','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.ai_search','I9R9LIDL','CNY',0.06,'https://redfox.hk/apis/tool-ai-search/I9R9LIDL','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.poll','3A3CIGL8','CNY',0,'https://redfox.hk/apis/tool-ai-search/3A3CIGL8','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.ai_search','KGX4SDXQ','CNY',0.06,'https://redfox.hk/apis/tool-ai-search/KGX4SDXQ','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.poll','AJWHKFQI','CNY',0,'https://redfox.hk/apis/tool-ai-search/AJWHKFQI','2026-10-20','Published base price; estimated per request, not actual supplier debit.')
ON CONFLICT(service,model) DO NOTHING;
