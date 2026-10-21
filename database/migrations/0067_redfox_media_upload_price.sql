-- Fixed general media upload; published zero price is an estimate, not a billing reconciliation.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note) VALUES
 ('redfox.media','6L178PZD','CNY',0,'https://redfox.hk/apis/tool/6L178PZD','2026-10-20','Published upload price; estimated per request. Multipart transport not yet live-verified.')
ON CONFLICT(service,model) DO NOTHING;
