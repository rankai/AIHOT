-- Fourteen fixed synchronous media / subtitle metadata / text tools.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note) VALUES
 ('redfox.media','9Q2PQBKU','CNY',0.12,'https://redfox.hk/apis/bilibili/9Q2PQBKU','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.transcript','API_1792053861083','CNY',0.06,'https://redfox.hk/apis/bilibili/API_1792053861083','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.transcript','API_1792051516512','CNY',0.06,'https://redfox.hk/apis/Youtube/API_1792051516512','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.query','API_1791881343238','CNY',0.06,'https://redfox.hk/apis/tool/API_1791881343238','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.media','AWUTFI4V','CNY',0.06,'https://redfox.hk/apis/tool-video-download/AWUTFI4V','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.media','D52IUEIM','CNY',0.06,'https://redfox.hk/apis/tool-video-download/D52IUEIM','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.media','7UW1PT1F','CNY',0.06,'https://redfox.hk/apis/tool-video-download/7UW1PT1F','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.media','MQMDU19Q','CNY',0.06,'https://redfox.hk/apis/tool-video-download/MQMDU19Q','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.media','QPNFJRG1','CNY',0.06,'https://redfox.hk/apis/tool-video-download/QPNFJRG1','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.media','U2NJ13MW','CNY',0.06,'https://redfox.hk/apis/tool-video-download/U2NJ13MW','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.media','0W27H3O6','CNY',0.06,'https://redfox.hk/apis/tool-video-download/0W27H3O6','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.media','0ZIWOO8P','CNY',0.06,'https://redfox.hk/apis/tool-video-download/0ZIWOO8P','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.media','CWX77QIH','CNY',0.06,'https://redfox.hk/apis/tool-video-download/CWX77QIH','2026-10-20','Published base price; estimated per request, not actual supplier debit.'),
 ('redfox.media','UUSP1G1P','CNY',0.06,'https://redfox.hk/apis/tool-video-download/UUSP1G1P','2026-10-20','Published base price; estimated per request, not actual supplier debit.')
ON CONFLICT(service,model) DO NOTHING;
