-- AlbumPro — file register rules (§7) and storage hardening for the private `order-files` bucket.
-- Object path convention (set by the app): <order code>/<category>/<file name>-v<version>

-- Uploaded files are immutable records: only `state` and `archived` ever change, and only under the rules below.
create or replace function order_files_rules() returns trigger language plpgsql set search_path = public as $$
declare approver boolean := has_perm('grading_approve', 'approve') or has_perm('design_approve', 'approve') or is_system()
                            or coalesce(current_setting('app.via_fn', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    if lower(new.ext) <> lower(coalesce(substring(new.file_name from '\.([^.]+)$'), '')) then raise exception 'file extension does not match the file name' using errcode = '23514'; end if;
    if lower(new.ext) not in ('jpg','jpeg','png','tif','tiff','psd','pdf','zip','ai','indd','cdr') then raise exception '.% is not an allowed file type', new.ext using errcode = '23514'; end if;
    if new.size_bytes > 5368709120 then raise exception 'file exceeds the 5 GB limit' using errcode = '23514'; end if;
    if btrim(new.storage_path) = '' then raise exception 'storage path is required' using errcode = '23514'; end if;
    new.state := 'draft'; new.archived := false;
    new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
    return new;
  end if;
  if new.order_id is distinct from old.order_id or new.category is distinct from old.category or new.file_name is distinct from old.file_name
     or new.ext is distinct from old.ext or new.size_bytes is distinct from old.size_bytes or new.version is distinct from old.version
     or new.storage_path is distinct from old.storage_path or new.checksum is distinct from old.checksum or new.uploaded_by is distinct from old.uploaded_by then
    raise exception 'an uploaded file is immutable: upload a new version instead' using errcode = '23514';
  end if;
  if new.state is distinct from old.state then
    if new.state = 'locked' and coalesce(current_setting('app.lock_ok', true), '') <> '1' then
      raise exception 'files are locked only through lock_final_print_file' using errcode = '42501';
    end if;
    if new.state in ('approved', 'rejected') and not approver then raise exception 'only an admin can approve or reject files' using errcode = '42501'; end if;
  end if;
  if new.archived is distinct from old.archived then
    if old.state = 'locked' then raise exception 'locked files cannot be archived' using errcode = '23514'; end if;
    if not (current_app_role() = 'admin' or is_system()) then raise exception 'only an admin can archive files' using errcode = '42501'; end if;
    if not new.archived then raise exception 'archived files cannot be restored; upload a new version' using errcode = '23514'; end if;
  end if;
  return new;
end $$;
create trigger files_rules_t before insert or update on order_files for each row execute function order_files_rules();
create unique index if not exists order_files_storage_path_key on order_files (storage_path);
revoke execute on function order_files_rules() from public, anon, authenticated;

create or replace function lock_final_print_file(p_file uuid) returns order_files language plpgsql security definer set search_path = public as $$
declare f order_files;
begin
  if current_app_role() <> 'admin' and not is_system() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into f from order_files where id = p_file;
  if not found or f.category <> 'final_print' then raise exception 'not a final print file'; end if;
  if f.archived then raise exception 'an archived file cannot be locked'; end if;
  if not exists (select 1 from proofs where order_id = f.order_id and status = 'approved') then raise exception 'final client approval required before locking'; end if;
  perform set_config('app.lock_ok', '1', true);
  update order_files set state = 'locked' where id = p_file returning * into f;
  perform set_config('app.lock_ok', '', true);
  return f;
end $$;

-- Storage: 5 GB per object (the platform plan may cap lower), and object names must follow the path convention.
update storage.buckets set file_size_limit = 5368709120 where id = 'order-files';
create policy order_files_path on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'order-files' or name ~ '^[A-Za-z0-9-]+/[a-z_]+/[^/].*$');
