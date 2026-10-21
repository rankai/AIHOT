INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note) VALUES
 ('redfox.video','JE93E37A','CNY',15,'https://redfox.hk/apis/tool-doubao-video/JE93E37A','2026-10-20','Documented base price; estimated request cost. Per-second and full-task billing not verified.'),
 ('redfox.poll','VBALJNC7','CNY',0,'https://redfox.hk/apis/tool-doubao-video/VBALJNC7','2026-10-20','Documented zero base price; every external poll still counts toward its request budget.')
ON CONFLICT(service,model) DO NOTHING;
