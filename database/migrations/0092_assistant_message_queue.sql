-- Session-owned FIFO requests; enqueue never reserves credits or creates a provider run.
ALTER TABLE assistant_sessions ADD COLUMN queue_paused boolean NOT NULL DEFAULT false;
CREATE TABLE assistant_message_queue (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES assistant_sessions(id),
  position bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  command_key text NOT NULL,
  command_hash text NOT NULL,
  input jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','quoted','submitted','cancelled')),
  quote jsonb,
  prepared_input jsonb,
  submitted_turn_id uuid REFERENCES assistant_turns(id),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, command_key)
);
CREATE INDEX assistant_message_queue_pending ON assistant_message_queue(session_id,position) WHERE state IN ('pending','quoted');
-- Explicit resume is tied to the exact interrupted turn, never inherited by its successor.
ALTER TABLE assistant_sessions ADD COLUMN queue_resume_turn_id uuid REFERENCES assistant_turns(id);
