-- Free currently effective prices are valid; the user's session allowance stays positive.
ALTER TABLE assistant_fee_authorizations DROP CONSTRAINT assistant_fee_authorizations_per_turn_limit_check;
ALTER TABLE assistant_fee_authorizations ADD CONSTRAINT assistant_fee_authorizations_per_turn_limit_check CHECK(per_turn_limit >= 0);
