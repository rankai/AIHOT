-- Request counts only; no inferred member credit price or automatic paid access.
INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES
 ('aliyun.wan.media',0,0,0),('aliyun.wan.video',0,0,0),('aliyun.wan.poll',0,0,0)
ON CONFLICT(service) DO NOTHING;
