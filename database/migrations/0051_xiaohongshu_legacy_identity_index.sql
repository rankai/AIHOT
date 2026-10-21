-- Signed query parameters may vary for the same documented native note path.
-- Only legacy generic identities participate; custom and fragment identities remain independent.
CREATE INDEX articles_xiaohongshu_legacy_identity_idx ON articles (identity_key text_pattern_ops)
WHERE identity_key LIKE 'url:https://xiaohongshu.com/explore/%' AND identity_key NOT LIKE '%#%';
