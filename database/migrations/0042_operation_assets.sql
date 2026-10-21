ALTER TABLE stored_files
  ADD COLUMN status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','deleting','deleted')),
  ADD COLUMN sha256 text,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
