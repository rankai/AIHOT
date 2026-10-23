INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note) VALUES
 ('redfox.image','API_1791533630312','CNY',1.5,'https://redfox.hk/apis/tool-gpt-image/API_1791533630312','2026-10-20','Documented base price; estimated request cost, per-image and total billing not verified.'),
 ('redfox.poll','API_1791533630405','CNY',0,'https://redfox.hk/apis/tool-gpt-image/API_1791533630405','2026-10-20','Documented base price; estimated request cost, per-image and total billing not verified.'),
 ('redfox.image','API_1791793667945','CNY',1,'https://redfox.hk/apis/tool-gemini-image/API_1791793667945','2026-10-20','Documented base price; estimated request cost, per-image and total billing not verified.'),
 ('redfox.poll','API_1791793668017','CNY',0,'https://redfox.hk/apis/tool-gemini-image/API_1791793668017','2026-10-20','Documented base price; estimated request cost, per-image and total billing not verified.'),
 ('redfox.image','K8CWLR4I','CNY',1,'https://redfox.hk/apis/tool-doubao-image/K8CWLR4I','2026-10-20','Documented base price; estimated request cost, per-image and total billing not verified.'),
 ('redfox.poll','HMOMP642','CNY',0,'https://redfox.hk/apis/tool-doubao-image/HMOMP642','2026-10-20','Documented base price; estimated request cost, per-image and total billing not verified.'),
 ('redfox.image','7OM96HCF','CNY',0.71,'https://redfox.hk/apis/tool-doubao-image/7OM96HCF','2026-10-20','Documented base price; estimated request cost, per-image and total billing not verified.'),
 ('redfox.poll','WH5U8KZE','CNY',0,'https://redfox.hk/apis/tool-doubao-image/WH5U8KZE','2026-10-20','Documented base price; estimated request cost, per-image and total billing not verified.')
ON CONFLICT(service,model) DO NOTHING;
