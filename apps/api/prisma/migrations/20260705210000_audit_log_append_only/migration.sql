-- Audit-Log manipulationssicher machen: UPDATE und DELETE werden auf
-- DB-Ebene verweigert – auch für die App selbst. Einträge können nur
-- angefügt werden (Append-only), wie in docs/security.md gefordert.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog ist append-only: % nicht erlaubt', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
