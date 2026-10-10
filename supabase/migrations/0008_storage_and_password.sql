-- 1. First-login password change: the user may clear their own must_change_password flag (and nothing else).
create or replace function complete_password_change() returns void language sql security definer set search_path = public as $$
  update profiles set must_change_password = false where id = auth.uid()
$$;
revoke execute on function complete_password_change() from public, anon;
grant execute on function complete_password_change() to authenticated;

-- 2. Private bucket for order files. Object path convention: <order code>/<category>/<file name>-v<version>
--    Read: anyone who may view orders. Upload: anyone doing production work. No update/delete policy: stored files are immutable;
--    "archiving" is a flag on order_files, never a physical removal (SRS §7: audit retained).
insert into storage.buckets (id, name, public) values ('order-files', 'order-files', false) on conflict (id) do nothing;

create policy order_files_read on storage.objects for select to authenticated
  using (bucket_id = 'order-files' and has_perm('order', 'view'));
create policy order_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'order-files' and (has_perm('order','write') or has_perm('grading','write') or has_perm('design','write') or has_perm('printing','write') or has_perm('qc','write')));
