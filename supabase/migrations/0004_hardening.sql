-- AlbumPro — lock down Supabase's default grants. Only signed-in staff (role `authenticated`) may touch data.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;

-- helpers that RLS policies and invoker triggers call as the signed-in user
grant execute on function current_app_role(), is_system(), has_perm(text, text), mask_text(text, int), invoice_recompute(uuid) to authenticated;
grant execute on function advance_order(uuid, stage_key, text, boolean), lock_final_print_file(uuid) to authenticated;

-- future objects created by the migration owner should not be open to anon either
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
