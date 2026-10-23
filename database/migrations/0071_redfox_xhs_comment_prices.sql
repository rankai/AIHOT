-- Submission is billed by actual comment batches of 20. The documented .06 base
-- is not a known per-request charge; minimum/rounding/failure billing are unverified.
INSERT INTO service_prices(service,model,currency,per_request,source_url,verified_on,note) VALUES
 ('redfox.query','5AM3X4HZ','CNY',NULL,'https://redfox.hk/apis/xiaohongshu/5AM3X4HZ','2026-10-20','Documented base .06 CNY per batch of 20 comments; actual per-request cost unknown.'),
 ('redfox.poll','LO93CE5K','CNY',0,'https://redfox.hk/apis/xiaohongshu/LO93CE5K','2026-10-20','Documented free polling; every external request consumes the poll request budget.')
ON CONFLICT(service,model) DO NOTHING;
