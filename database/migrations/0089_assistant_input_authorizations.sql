CREATE TABLE assistant_fee_authorizations (
 id uuid PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES assistant_sessions(id),
 version integer NOT NULL CHECK(version > 0),
 enabled boolean NOT NULL,
 total_limit integer NOT NULL CHECK(total_limit > 0),
 allow_search boolean NOT NULL,
 turn_price jsonb NOT NULL,
 search_price jsonb,
 per_turn_limit integer NOT NULL CHECK(per_turn_limit > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 UNIQUE(session_id,version)
);
CREATE TABLE assistant_auto_charges (
 run_id bigint PRIMARY KEY REFERENCES operation_runs(id),
 authorization_id uuid NOT NULL REFERENCES assistant_fee_authorizations(id),
 turn_id uuid NOT NULL REFERENCES assistant_turns(id),
 kind text NOT NULL CHECK(kind IN ('turn','search')),
 quote_id uuid NOT NULL REFERENCES member_tool_quotes(id),
 UNIQUE(turn_id,kind)
);
ALTER TABLE assistant_session_inputs ADD COLUMN command_key text;
ALTER TABLE assistant_session_inputs ADD COLUMN command_hash text;
CREATE UNIQUE INDEX assistant_input_commands ON assistant_session_inputs(session_id,command_key) WHERE command_key IS NOT NULL;
