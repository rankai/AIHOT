-- Private assistant records; financial facts remain in existing operation and credit tables.
CREATE TABLE assistant_sessions (
 id uuid PRIMARY KEY, owner_user_id bigint NOT NULL REFERENCES site_users(id), assistant_id text NOT NULL CHECK(assistant_id ~ '^[a-z][a-z0-9_-]{0,79}$'),
 assistant_name text NOT NULL, profile_version text NOT NULL, title text NOT NULL, brief text NOT NULL DEFAULT '', revision integer NOT NULL DEFAULT 1,
 command_key text NOT NULL, command_hash text NOT NULL, active_turn_id uuid, archived_at timestamptz, deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_user_id,command_key)
);
CREATE FUNCTION assistant_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.assistant_id <> OLD.assistant_id OR NEW.owner_user_id <> OLD.owner_user_id THEN RAISE EXCEPTION 'assistant identity is immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER assistant_identity_immutable BEFORE UPDATE ON assistant_sessions FOR EACH ROW EXECUTE FUNCTION assistant_identity_immutable();
CREATE TABLE assistant_session_inputs (id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES assistant_sessions(id), text text NOT NULL, hash text NOT NULL, source jsonb NOT NULL DEFAULT '{}');
CREATE TABLE assistant_turns (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES assistant_sessions(id), parent_operation_run_id bigint NOT NULL UNIQUE REFERENCES operation_runs(id),
 command_key text NOT NULL, command_hash text NOT NULL, snapshot jsonb NOT NULL, phase text NOT NULL DEFAULT 'executing', pending_question jsonb,
 model_calls integer NOT NULL DEFAULT 0 CHECK(model_calls BETWEEN 0 AND 8), child_calls integer NOT NULL DEFAULT 0 CHECK(child_calls BETWEEN 0 AND 20),
 UNIQUE(session_id,command_key)
);
CREATE TABLE assistant_model_steps (
 id uuid PRIMARY KEY, turn_id uuid NOT NULL REFERENCES assistant_turns(id), model_ordinal integer NOT NULL, operation_step_version integer NOT NULL,
 request_snapshot jsonb NOT NULL, request_hash text NOT NULL, receipt_id bigint REFERENCES receipts(id), decision jsonb,
 UNIQUE(turn_id,model_ordinal), UNIQUE(turn_id,operation_step_version)
);
CREATE TABLE assistant_activations (
 id uuid PRIMARY KEY, turn_id uuid NOT NULL REFERENCES assistant_turns(id), model_step_id uuid REFERENCES assistant_model_steps(id), identity_hash text NOT NULL,
 candidate jsonb NOT NULL, UNIQUE(turn_id,identity_hash)
);
CREATE TABLE assistant_messages (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES assistant_sessions(id), seq integer NOT NULL, turn_id uuid REFERENCES assistant_turns(id),
 role text NOT NULL CHECK(role IN ('user','assistant','tool')), text text NOT NULL, model_message jsonb, UNIQUE(session_id,seq)
);
CREATE TABLE assistant_tool_calls (
 id uuid PRIMARY KEY, turn_id uuid NOT NULL REFERENCES assistant_turns(id), model_step_id uuid NOT NULL REFERENCES assistant_model_steps(id),
 ordinal integer NOT NULL, upstream_id text NOT NULL, name text NOT NULL, input jsonb NOT NULL, activation_id uuid REFERENCES assistant_activations(id),
 state text NOT NULL DEFAULT 'pending', proposal_revision integer NOT NULL DEFAULT 1, quote jsonb, child_run_id bigint UNIQUE REFERENCES operation_runs(id),
 result jsonb, command_hash text, UNIQUE(model_step_id,ordinal)
);
CREATE TABLE assistant_artifact_versions (
 session_id uuid NOT NULL REFERENCES assistant_sessions(id), artifact_id uuid NOT NULL, version integer NOT NULL, base_version integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('text-draft','xhs-note')), schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
 turn_id uuid REFERENCES assistant_turns(id), activation_id uuid REFERENCES assistant_activations(id), content jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(artifact_id,version)
);
CREATE TABLE assistant_events (session_id uuid NOT NULL REFERENCES assistant_sessions(id), seq integer NOT NULL, type text NOT NULL, entity_id text NOT NULL, PRIMARY KEY(session_id,seq));
CREATE TABLE assistant_handoffs (
 owner_user_id bigint NOT NULL REFERENCES site_users(id), command_key text NOT NULL, request_hash text NOT NULL,
 source_session_id uuid NOT NULL, target_session_id uuid NOT NULL, target_deleted boolean NOT NULL DEFAULT false, PRIMARY KEY(owner_user_id,command_key)
);
CREATE INDEX assistant_sessions_owner ON assistant_sessions(owner_user_id,created_at DESC);
INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES ('assistant.text',0,0,0) ON CONFLICT DO NOTHING;
