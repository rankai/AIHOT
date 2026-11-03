-- Add image deliveries without rewriting historical writing versions.
ALTER TABLE assistant_artifact_versions DROP CONSTRAINT assistant_artifact_versions_kind_check;
ALTER TABLE assistant_artifact_versions ADD CONSTRAINT assistant_artifact_versions_kind_check CHECK (kind IN ('text-draft','xhs-note','image'));
