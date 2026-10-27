-- Six fixed ASR submit/result pairs. Free polls still consume request budgets.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note) VALUES
 ('redfox.transcript','8DCJW2ZF','CNY',0.6,'https://redfox.hk/apis/douyin/8DCJW2ZF','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.poll','D4YT0XVJ','CNY',0,'https://redfox.hk/apis/douyin/D4YT0XVJ','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.transcript','DCZW5V7A','CNY',0.6,'https://redfox.hk/apis/xiaohongshu/DCZW5V7A','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.poll','9UHXOXSF','CNY',0,'https://redfox.hk/apis/xiaohongshu/9UHXOXSF','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.transcript','HR8CU3GG','CNY',0.6,'https://redfox.hk/apis/shipinhao/HR8CU3GG','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.poll','6QSXFDZV','CNY',0,'https://redfox.hk/apis/shipinhao/6QSXFDZV','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.transcript','8TUUDDCJ','CNY',0.6,'https://redfox.hk/apis/kuaishou/8TUUDDCJ','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.poll','PNNXJ463','CNY',0,'https://redfox.hk/apis/kuaishou/PNNXJ463','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.transcript','SQ4FHFZX','CNY',0.6,'https://redfox.hk/apis/bilibili/SQ4FHFZX','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.poll','YYXG62WO','CNY',0,'https://redfox.hk/apis/bilibili/YYXG62WO','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.transcript','API_1792033347215','CNY',0.06,'https://redfox.hk/apis/tool/API_1792033347215','2026-10-20','Published base price; estimated per request, not an actual supplier debit.'),
 ('redfox.poll','3J8LSOJZ','CNY',0,'https://redfox.hk/apis/tool/3J8LSOJZ','2026-10-20','Published base price; estimated per request, not an actual supplier debit.')
ON CONFLICT(service,model) DO NOTHING;
