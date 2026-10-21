-- Only canonical generic Toutiao work permalinks; no profiles, fragments or custom identities.
-- A large existing database may prebuild this exact named index CONCURRENTLY in a
-- separately authorized deployment window, outside the migration transaction.
CREATE INDEX IF NOT EXISTS articles_toutiao_legacy_identity_idx ON articles
  ((substring(identity_key from '^url:https://toutiao[.]com/(?:a|group/|article/|video/)([0-9]+)/?([?][^#]*)?$')))
WHERE identity_key ~ '^url:https://toutiao[.]com/(?:a|group/|article/|video/)[0-9]+/?([?][^#]*)?$';
