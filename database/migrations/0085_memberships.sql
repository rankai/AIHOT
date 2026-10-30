-- Offline payment confirmations extend membership and grant through the existing wallet.
CREATE TABLE member_memberships (
 user_id bigint PRIMARY KEY REFERENCES site_users(id),
 plan_id text NOT NULL CHECK (plan_id IN ('basic','creator','studio')),
 starts_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK (expires_at > starts_at)
);
CREATE TABLE member_membership_payments (
 id uuid PRIMARY KEY,
 user_id bigint NOT NULL REFERENCES site_users(id),
 plan_id text NOT NULL CHECK (plan_id IN ('basic','creator','studio')),
 amount_fen integer NOT NULL CHECK (amount_fen > 0),
 credits integer NOT NULL CHECK (credits > 0),
 receipt_reference text NOT NULL UNIQUE,
 reason text NOT NULL,
 period_start timestamptz NOT NULL,
 period_end timestamptz NOT NULL CHECK (period_end > period_start),
 actor text NOT NULL,
 command_key text NOT NULL,
 input_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor, command_key)
);
CREATE INDEX member_membership_payments_user_idx ON member_membership_payments(user_id, created_at DESC);
CREATE TABLE member_price_applications (
 version text PRIMARY KEY,
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
