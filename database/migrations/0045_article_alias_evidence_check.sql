-- Reject JSON null as well as absent evidence fields. 0044 is already applied.
ALTER TABLE article_identity_aliases DROP CONSTRAINT article_identity_aliases_evidence_check;
ALTER TABLE article_identity_aliases ADD CONSTRAINT article_identity_aliases_evidence_check CHECK ((
  jsonb_typeof(evidence) = 'object' AND
  jsonb_typeof(evidence->'kind') = 'string' AND
  jsonb_typeof(evidence->'reference') = 'string' AND
  evidence->>'kind' IN ('receipt', 'result', 'audit') AND
  length(evidence->>'reference') > 0
) IS TRUE);
