ALTER TABLE member_membership_payments ADD CONSTRAINT membership_plan_amounts CHECK (
 (plan_id='basic' AND amount_fen=9900 AND credits=10000) OR
 (plan_id='creator' AND amount_fen=29900 AND credits=33000) OR
 (plan_id='studio' AND amount_fen=69900 AND credits=80000)
);
CREATE TRIGGER member_membership_payments_immutable BEFORE UPDATE OR DELETE ON member_membership_payments
 FOR EACH ROW EXECUTE FUNCTION prevent_member_credit_history_change();
CREATE TRIGGER member_price_applications_immutable BEFORE UPDATE OR DELETE ON member_price_applications
 FOR EACH ROW EXECUTE FUNCTION prevent_member_credit_history_change();
