-- =============================================================================
-- Adds the read-only "viewer" role.
-- =============================================================================
-- Postgres requires a new enum value to be committed before it can be used, so
-- this migration only adds the value. Everything that uses it lives in
-- 20260918090100_viewer_access.sql.

alter type public.app_role add value if not exists 'viewer';
