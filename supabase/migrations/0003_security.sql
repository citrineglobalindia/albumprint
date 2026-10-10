-- AlbumPro — role permissions (SRS §21) and row-level security.

-- ───────── permission matrix (ALB-FR-0448 … 0464) ─────────
insert into role_permissions(role, module, level) values
 -- module,               admin       reception     colour        designer      printing      qc            accounts
 ('admin','customer','full'),('reception','customer','create_edit'),('colour','customer','view'),('designer','customer','view'),('printing','customer','view'),('qc','customer','view'),('accounts','customer','view'),
 ('admin','order','full'),('reception','order','create_edit'),('colour','order','view'),('designer','order','view'),('printing','order','view'),('qc','order','view'),('accounts','order','view'),
 ('admin','print_spec','full'),('reception','print_spec','create_edit'),('colour','print_spec','view'),('designer','print_spec','view'),('printing','print_spec','view'),('qc','print_spec','view'),('accounts','print_spec','view'),
 ('admin','grading','full'),('reception','grading','view'),('colour','grading','work'),('designer','grading','view'),('printing','grading','view'),('qc','grading','view'),('accounts','grading','none'),
 ('admin','grading_approve','approve'),('reception','grading_approve','none'),('colour','grading_approve','none'),('designer','grading_approve','none'),('printing','grading_approve','none'),('qc','grading_approve','none'),('accounts','grading_approve','none'),
 ('admin','design','full'),('reception','design','view'),('colour','design','view'),('designer','design','work'),('printing','design','view'),('qc','design','view'),('accounts','design','none'),
 ('admin','design_approve','approve'),('reception','design_approve','none'),('colour','design_approve','none'),('designer','design_approve','none'),('printing','design_approve','none'),('qc','design_approve','none'),('accounts','design_approve','none'),
 ('admin','client_proof','full'),('reception','client_proof','limited'),('colour','client_proof','none'),('designer','client_proof','none'),('printing','client_proof','none'),('qc','client_proof','none'),('accounts','client_proof','none'),
 ('admin','client_correction','full'),('reception','client_correction','view'),('colour','client_correction','none'),('designer','client_correction','work'),('printing','client_correction','none'),('qc','client_correction','none'),('accounts','client_correction','none'),
 ('admin','release_print','approve'),('reception','release_print','none'),('colour','release_print','none'),('designer','release_print','none'),('printing','release_print','none'),('qc','release_print','none'),('accounts','release_print','none'),
 ('admin','printing','full'),('reception','printing','view'),('colour','printing','none'),('designer','printing','view'),('printing','printing','work'),('qc','printing','view'),('accounts','printing','none'),
 ('admin','qc','full'),('reception','qc','view'),('colour','qc','none'),('designer','qc','view'),('printing','qc','view'),('qc','qc','work'),('accounts','qc','none'),
 ('admin','delivery','full'),('reception','delivery','update'),('colour','delivery','none'),('designer','delivery','none'),('printing','delivery','update'),('qc','delivery','update'),('accounts','delivery','view'),
 ('admin','payments','full'),('reception','payments','limited'),('colour','payments','none'),('designer','payments','none'),('printing','payments','none'),('qc','payments','none'),('accounts','payments','full'),
 ('admin','invoices','full'),('reception','invoices','view'),('colour','invoices','none'),('designer','invoices','none'),('printing','invoices','none'),('qc','invoices','none'),('accounts','invoices','full'),
 ('admin','reports','full'),('reception','reports','limited'),('colour','reports','limited'),('designer','reports','limited'),('printing','reports','limited'),('qc','reports','limited'),('accounts','reports','limited'),
 ('admin','users','full'),('reception','users','none'),('colour','users','none'),('designer','users','none'),('printing','users','none'),('qc','users','none'),('accounts','users','none'),
 -- ALB-FR-0003: who may see unmasked phone / email
 ('admin','pii','full'),('reception','pii','view'),('colour','pii','none'),('designer','pii','none'),('printing','pii','none'),('qc','pii','none'),('accounts','pii','view');

insert into settings(key, value) values
 ('pricing',  '{"discount_approval_pct":10,"gst_rate":18}'),
 ('workflow', '{"allow_delivery_without_full_payment":false,"auto_assign_next_dept":true}');

-- need: 'view' | 'write' | 'approve'
create or replace function has_perm(p_module text, p_need text default 'view') returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_need
      when 'view'    then rp.level <> 'none'
      when 'write'   then rp.level in ('limited','update','work','create_edit','full')
      when 'approve' then rp.level in ('approve','full')
      else false end
    from role_permissions rp where rp.role = current_app_role() and rp.module = p_module), false)
$$;

-- ───────── protect workflow columns: only trusted functions may change them ─────────
create or replace function orders_protect() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.via_fn', true), '') <> '1' and not is_system() and (
       new.stage is distinct from old.stage or new.main_status is distinct from old.main_status
    or new.grading_status is distinct from old.grading_status or new.design_status is distinct from old.design_status
    or new.print_status is distinct from old.print_status or new.qc_status is distinct from old.qc_status
    or new.delivery_status is distinct from old.delivery_status or new.closure_status is distinct from old.closure_status
    or new.paid is distinct from old.paid or new.pay_status is distinct from old.pay_status) then
    raise exception 'workflow and payment fields change only through advance_order / payments' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger orders_protect_t before update on orders for each row execute function orders_protect();

-- QC decision drives order.qc_status (ALB-FR-0488); rework/fail loops back via advance_order
create or replace function qc_sync() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.via_fn', '1', true);
  update orders set qc_status = new.decision where id = new.order_id;
  perform set_config('app.via_fn', '', true);
  if new.decision <> 'pending' then new.decided_at := coalesce(new.decided_at, now()); end if;
  return new;
end $$;
create trigger qc_sync_t before insert or update of decision on qc_inspections for each row execute function qc_sync();

-- ───────── masked customer directory (ALB-FR-0003) ─────────
create or replace function mask_text(p text, keep int) returns text language sql immutable as $$
  select case when p is null then null else left(p, keep) || repeat('•', greatest(char_length(p) - keep - 2, 0)) || right(p, 2) end $$;

create view customers_safe as
  select id, code, studio_name, contact_person, segment, active, city, state, created_at,
         case when has_perm('pii','view') then mobile   else mask_text(mobile, 3) end as mobile,
         case when has_perm('pii','view') then whatsapp else mask_text(whatsapp, 3) end as whatsapp,
         case when has_perm('pii','view') then email    else mask_text(email, 2) end as email,
         case when has_perm('pii','view') then gstin    else mask_text(gstin, 2) end as gstin
  from customers
  where current_app_role() is not null;               -- runs as owner: bypasses RLS, so gate on being active staff

-- ───────── row-level security ─────────
do $$ declare t text; begin
  foreach t in array array['profiles','counters','customers','orders','order_specs','order_files','stage_transitions','tasks','corrections','proofs','print_jobs',
    'qc_inspections','deliveries','invoices','invoice_lines','payments','masters','products','settings','sla_rules','role_permissions','comm_log','audit_log'] loop
    execute format('alter table %I enable row level security', t);
  end loop; end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on customers_safe to authenticated;
revoke all on counters from authenticated;
revoke update, delete on audit_log from authenticated;
revoke execute on function next_code(text, text, int) from public;
grant execute on function advance_order(uuid, stage_key, text, boolean), lock_final_print_file(uuid), has_perm(text, text) to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- profiles: any active staff can read names; only user admins write
create policy profiles_read  on profiles for select to authenticated using (current_app_role() is not null);
create policy profiles_write on profiles for all    to authenticated using (has_perm('users','write')) with check (has_perm('users','write'));

-- customers: raw rows only for roles allowed PII; everyone else uses customers_safe
create policy customers_read  on customers for select to authenticated using (has_perm('pii','view'));
create policy customers_write on customers for insert to authenticated with check (has_perm('customer','write'));
create policy customers_upd   on customers for update to authenticated using (has_perm('customer','write')) with check (has_perm('customer','write'));

-- orders & spec
create policy orders_read  on orders for select to authenticated using (has_perm('order','view'));
create policy orders_ins   on orders for insert to authenticated with check (has_perm('order','write'));
create policy orders_upd   on orders for update to authenticated using (has_perm('order','write')) with check (has_perm('order','write'));
create policy specs_read   on order_specs for select to authenticated using (has_perm('print_spec','view'));
create policy specs_write  on order_specs for all    to authenticated using (has_perm('print_spec','write')) with check (has_perm('print_spec','write'));

-- files: read with order view; upload by anyone who does production work; archive by admin
create policy files_read  on order_files for select to authenticated using (has_perm('order','view'));
create policy files_ins   on order_files for insert to authenticated with check (
  has_perm('order','write') or has_perm('grading','write') or has_perm('design','write') or has_perm('printing','write') or has_perm('qc','write'));
create policy files_upd   on order_files for update to authenticated using (has_perm('order','write') or has_perm('grading','write') or has_perm('design','write')) with check (true);

-- tasks / corrections / proofs
create policy tasks_read  on tasks for select to authenticated using (has_perm('order','view'));
create policy tasks_write on tasks for all    to authenticated using (has_perm('grading','write') or has_perm('design','write') or has_perm('printing','write') or has_perm('qc','write') or has_perm('order','write'))
                                                              with check (has_perm('grading','write') or has_perm('design','write') or has_perm('printing','write') or has_perm('qc','write') or has_perm('order','write'));
create policy corr_read   on corrections for select to authenticated using (has_perm('client_correction','view'));
create policy corr_write  on corrections for all    to authenticated using (has_perm('client_correction','write')) with check (has_perm('client_correction','write'));
create policy proofs_read on proofs for select to authenticated using (has_perm('client_proof','view') or has_perm('order','view'));
create policy proofs_write on proofs for all   to authenticated using (has_perm('client_proof','write')) with check (has_perm('client_proof','write'));

-- production
create policy print_read  on print_jobs for select to authenticated using (has_perm('printing','view'));
create policy print_write on print_jobs for all    to authenticated using (has_perm('printing','write')) with check (has_perm('printing','write'));
create policy qc_read     on qc_inspections for select to authenticated using (has_perm('qc','view'));
create policy qc_write    on qc_inspections for all    to authenticated using (has_perm('qc','write')) with check (has_perm('qc','write'));
create policy del_read    on deliveries for select to authenticated using (has_perm('delivery','view'));
create policy del_write   on deliveries for all    to authenticated using (has_perm('delivery','write')) with check (has_perm('delivery','write'));

-- finance
create policy pay_read    on payments for select to authenticated using (has_perm('payments','view'));
create policy pay_ins     on payments for insert to authenticated with check (has_perm('payments','write') and (kind = 'payment' or has_perm('invoices','write')));  -- refunds: finance only
create policy inv_read    on invoices for select to authenticated using (has_perm('invoices','view'));
create policy inv_write   on invoices for all    to authenticated using (has_perm('invoices','write')) with check (has_perm('invoices','write') and (discount_approved_by is null or has_perm('users','write')));
create policy invl_read   on invoice_lines for select to authenticated using (has_perm('invoices','view'));
create policy invl_write  on invoice_lines for all    to authenticated using (has_perm('invoices','write')) with check (has_perm('invoices','write'));

-- reference data
create policy masters_read  on masters for select to authenticated using (current_app_role() is not null);
create policy masters_write on masters for all    to authenticated using (has_perm('users','write')) with check (has_perm('users','write'));
create policy products_read  on products for select to authenticated using (current_app_role() is not null);
create policy products_write on products for all    to authenticated using (has_perm('users','write')) with check (has_perm('users','write'));
create policy sla_read   on sla_rules for select to authenticated using (current_app_role() is not null);
create policy sla_write  on sla_rules for all    to authenticated using (has_perm('users','write')) with check (has_perm('users','write'));
create policy trans_read on stage_transitions for select to authenticated using (current_app_role() is not null);
create policy perms_read  on role_permissions for select to authenticated using (current_app_role() is not null);
create policy perms_write on role_permissions for all    to authenticated using (has_perm('users','write')) with check (has_perm('users','write'));
create policy settings_read  on settings for select to authenticated using (has_perm('users','view'));
create policy settings_write on settings for all    to authenticated using (has_perm('users','write')) with check (has_perm('users','write'));

-- communications & audit
create policy comm_read  on comm_log for select to authenticated using (has_perm('order','view'));
create policy comm_write on comm_log for insert to authenticated with check (has_perm('order','write') or has_perm('client_proof','write'));
create policy audit_read on audit_log for select to authenticated using (has_perm('users','view'));
