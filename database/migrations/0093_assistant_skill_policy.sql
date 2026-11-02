-- Explicitly preserve the two deployed skills; newly registered keys default closed in code.
INSERT INTO settings(key,value,updated_by) VALUES
 ('assistant.skills.general-writing','{"acceptingNew":true,"revision":1}'::jsonb,'migration:0093'),
 ('assistant.skills.xiaohongshu-creator','{"acceptingNew":true,"revision":1}'::jsonb,'migration:0093')
ON CONFLICT(key) DO NOTHING;
ALTER TABLE assistant_message_queue ADD COLUMN admission_snapshot jsonb;
-- Only these previously accepted rows may freeze the explicit pre-policy v2/v3 scope once.
UPDATE assistant_message_queue SET admission_snapshot='{"legacy":"0093"}'::jsonb WHERE state IN ('pending','quoted');
