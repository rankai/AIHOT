-- Creation command identity belongs to the subscription, independent of later edits.
ALTER TABLE collection_subscriptions
  ADD COLUMN creation_command_key text UNIQUE,
  ADD COLUMN creation_input_hash text,
  ADD CONSTRAINT collection_subscription_creation_pair CHECK (
    (creation_command_key IS NULL) = (creation_input_hash IS NULL)
  );
