-- Confirmed cross-type work identifiers; material ownership remains on articles.
CREATE TABLE article_identity_aliases (
  alias_key text PRIMARY KEY,
  article_id text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  evidence jsonb NOT NULL CHECK (
    jsonb_typeof(evidence) = 'object' AND evidence ?& ARRAY['kind', 'reference'] AND
    evidence->>'kind' IN ('receipt', 'result', 'audit') AND
    length(evidence->>'reference') > 0
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX article_identity_aliases_article_idx ON article_identity_aliases(article_id);
