-- A superseded attempt may still return a paid response. Preserve that evidence without
-- replacing the current receipt response or changing the newer attempt's state.
ALTER TABLE receipt_attempts ADD COLUMN response jsonb;
