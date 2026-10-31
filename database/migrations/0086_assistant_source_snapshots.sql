-- Sources remain readable when transient research results reach their retention deadline.
ALTER TABLE assistant_artifact_versions ADD COLUMN source_snapshot jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(source_snapshot)='array');
