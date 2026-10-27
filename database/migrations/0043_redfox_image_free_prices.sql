-- Published free upload/poll list prices, still metered attempts. Submit dimensions/quantity
-- pricing is unverified and deliberately has no per-request estimate here.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note)
VALUES ('redfox.media','FXDGJO1V','CNY',0,'https://redfox.hk/apis/tool/FXDGJO1V','2026-10-20','Published zero list price; estimated, not a verified debit.'),
       ('redfox.poll','849ONCDF','CNY',0,'https://redfox.hk/apis/tool-gpt-image/849ONCDF','2026-10-20','Published zero list price; estimated, not a verified debit.')
ON CONFLICT(service,model) DO NOTHING;
