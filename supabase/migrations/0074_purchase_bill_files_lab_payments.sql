-- 1) Purchase bill files: the supplier's bill (PDF / photo) kept with an album's purchase, in a private bucket that only
--    admin and accounts can read (it shows what we pay).
-- 2) Lab payments: what we have paid each lab, so a lab's payable = its purchase bills − payments made.
-- 3) Uploaded files: the person who uploaded a file may remove it while it is still a draft (a wrong upload); the admin may
--    remove any file that is not locked. (Before, only the admin could, so a designer's wrong upload came back.)

alter table album_purchases
  add column if not exists bill_file text,          -- storage path in the purchase-bills bucket
  add column if not exists bill_file_name text;     -- the name the file was uploaded with

insert into storage.buckets (id, name, public, file_size_limit) values ('purchase-bills', 'purchase-bills', false, 26214400)
  on conflict (id) do nothing;
drop policy if exists purchase_bills_read on storage.objects;
drop policy if exists purchase_bills_write on storage.objects;
drop policy if exists purchase_bills_delete on storage.objects;
create policy purchase_bills_read   on storage.objects for select to authenticated using (bucket_id = 'purchase-bills' and has_perm('invoices', 'approve'));
create policy purchase_bills_write  on storage.objects for insert to authenticated with check (bucket_id = 'purchase-bills' and has_perm('invoices', 'approve'));
create policy purchase_bills_delete on storage.objects for delete to authenticated using (bucket_id = 'purchase-bills' and has_perm('invoices', 'approve'));

create table if not exists lab_payments (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references labs(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  mode pay_mode not null default 'bank_transfer',
  reference text, note text,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists lab_payments_lab_idx on lab_payments(lab_id);
alter table lab_payments enable row level security;
drop policy if exists lab_payments_rw on lab_payments;
create policy lab_payments_rw on lab_payments for all to authenticated using (has_perm('invoices', 'approve')) with check (has_perm('invoices', 'approve'));
grant select, insert, update, delete on lab_payments to authenticated;
drop trigger if exists lab_payments_audit on lab_payments;
create trigger lab_payments_audit after insert or update or delete on lab_payments for each row execute function audit_row();

-- uploaded files: who may remove (archive) one
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
    if old.state = 'locked' then raise exception 'locked files cannot be removed' using errcode = '23514'; end if;
    if not (current_app_role() = 'admin' or is_system() or (old.uploaded_by = auth.uid() and old.state in ('draft', 'submitted', 'rejected'))) then
      raise exception 'only the person who uploaded this file (while it is not yet approved) or an admin can remove it' using errcode = '42501';
    end if;
    if not new.archived then raise exception 'removed files cannot be restored; upload a new version' using errcode = '23514'; end if;
  end if;
  return new;
end $$;
revoke execute on function order_files_rules() from public, anon, authenticated;

notify pgrst, 'reload schema';
