-- Trigger-only functions must not be callable through the REST API; pin search_path on the remaining stamp triggers.
revoke execute on function audit_admin_row(), comm_notify(), profile_joined_notify(), profiles_keep_an_admin() from public, anon, authenticated;
alter function perms_keep_admin_access() set search_path = public;
alter function settings_stamp() set search_path = public;
alter function ntpl_stamp() set search_path = public;
