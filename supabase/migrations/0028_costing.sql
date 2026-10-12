-- Album costing: reception only records the number of sheets; the admin then splits each album into priced lines (cover, paper, box…)
-- picked from the product catalog. The costing finalizes into the order total, and invoices are generated from it.
create table order_costing (
  order_id uuid primary key references orders(id) on delete cascade,
  design_charge numeric(12,2) not null default 0 check (design_charge >= 0),
  grading_images int not null default 0 check (grading_images >= 0),
  grading_rate numeric(12,2) not null default 0 check (grading_rate >= 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  gst_pct numeric(5,2) not null default 18 check (gst_pct between 0 and 100),
  finalized_at timestamptz,
  finalized_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
create table album_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  album_id uuid not null references order_albums(id) on delete cascade,
  position int not null check (position >= 1),
  item_id uuid references catalog_items(id),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  unit text not null default 'Nos',
  qty numeric(10,2) not null check (qty > 0),
  counts_sheets boolean not null default true,         -- this line covers sheets of the album (cover, inside paper…); boxes and bags do not
  remarks text,
  dimension text,
  sell_price numeric(12,2) not null default 0 check (sell_price >= 0),
  unique (album_id, position)
);
create index album_lines_order_idx on album_lines (order_id);
create table album_line_costs (                          -- the purchase price is admin-only, like the catalog cost
  line_id uuid primary key references album_lines(id) on delete cascade,
  cost_price numeric(12,2) not null check (cost_price >= 0)
);
alter table order_costing enable row level security;
alter table album_lines enable row level security;
alter table album_line_costs enable row level security;
revoke all on order_costing, album_lines, album_line_costs from anon;
grant select, insert, update on order_costing to authenticated;
grant select, insert, update, delete on album_lines, album_line_costs to authenticated;
create policy costing_read  on order_costing for select to authenticated using (has_perm('order', 'view'));
create policy costing_ins   on order_costing for insert to authenticated with check (current_app_role() = 'admin');
create policy costing_upd   on order_costing for update to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create policy alines_read   on album_lines for select to authenticated using (has_perm('order', 'view'));
create policy alines_write  on album_lines for all    to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create policy alcosts_admin on album_line_costs for all to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');

create or replace function costing_locked(p_order uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select finalized_at is not null from order_costing where order_id = p_order), false) $$;
revoke execute on function costing_locked(uuid) from public, anon;
grant execute on function costing_locked(uuid) to authenticated;

create or replace function album_lines_guard() returns trigger language plpgsql set search_path = public as $$
declare oid uuid := coalesce(new.order_id, old.order_id);
begin
  if costing_locked(oid) then raise exception 'the costing is finalized: reopen it to change the lines' using errcode = '23514'; end if;
  return coalesce(new, old);
end $$;
create trigger album_lines_guard_t before insert or update or delete on album_lines for each row execute function album_lines_guard();
create trigger album_lines_closed before insert or update on album_lines for each row execute function guard_child_of_closed();

create or replace function album_line_costs_guard() returns trigger language plpgsql set search_path = public as $$
declare oid uuid;
begin
  select order_id into oid from album_lines where id = coalesce(new.line_id, old.line_id);
  if oid is not null and costing_locked(oid) then raise exception 'the costing is finalized: reopen it to change the lines' using errcode = '23514'; end if;
  return coalesce(new, old);
end $$;
create trigger album_line_costs_guard_t before insert or update or delete on album_line_costs for each row execute function album_line_costs_guard();

create or replace function order_costing_guard() returns trigger language plpgsql set search_path = public as $$
declare via boolean := coalesce(current_setting('app.costing_fn', true), '') = '1';
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then new.finalized_at := null; new.finalized_by := null; return new; end if;
  if new.finalized_at is distinct from old.finalized_at and not via then raise exception 'use finalize_costing / reopen_costing' using errcode = '42501'; end if;
  if old.finalized_at is not null and not via and (to_jsonb(new) - 'updated_at') <> (to_jsonb(old) - 'updated_at') then
    raise exception 'the costing is finalized: reopen it to change it' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger order_costing_guard_t before insert or update on order_costing for each row execute function order_costing_guard();
create trigger order_costing_closed before insert or update on order_costing for each row execute function guard_child_of_closed();
revoke execute on function album_lines_guard(), album_line_costs_guard(), order_costing_guard() from public, anon, authenticated;

-- Finalize: the server recomputes the total from the lines, writes it to the order and locks the costing.
create or replace function finalize_costing(p_order uuid) returns jsonb language plpgsql set search_path = public as $$
declare c order_costing; sub numeric; disc numeric; tax numeric; tot numeric;
begin
  if current_app_role() <> 'admin' and not is_system() then raise exception 'only an admin can finalize the costing' using errcode = '42501'; end if;
  select * into c from order_costing where order_id = p_order;
  if not found then raise exception 'save the costing first'; end if;
  if c.finalized_at is not null then raise exception 'the costing is already finalized'; end if;
  if not exists (select 1 from album_lines where order_id = p_order) then raise exception 'add at least one line before finalizing'; end if;
  select coalesce(sum(qty * sell_price), 0) into sub from album_lines where order_id = p_order;
  sub := sub + c.design_charge + c.grading_images * c.grading_rate;
  disc := round(sub * c.discount_pct / 100); tax := round((sub - disc) * c.gst_pct / 100); tot := sub - disc + tax;
  perform set_config('app.costing_fn', '1', true);
  update order_costing set finalized_at = now(), finalized_by = auth.uid() where order_id = p_order;
  update orders set total = tot where id = p_order;
  perform set_config('app.costing_fn', '', true);
  return jsonb_build_object('subtotal', sub, 'discount', disc, 'tax', tax, 'total', tot);
end $$;
create or replace function reopen_costing(p_order uuid) returns void language plpgsql set search_path = public as $$
begin
  if current_app_role() <> 'admin' and not is_system() then raise exception 'only an admin can reopen the costing' using errcode = '42501'; end if;
  if exists (select 1 from invoices where order_id = p_order and kind = 'invoice' and status <> 'void') then raise exception 'invoices exist for this order: void them before reopening the costing'; end if;
  perform set_config('app.costing_fn', '1', true);
  update order_costing set finalized_at = null, finalized_by = null where order_id = p_order;
  perform set_config('app.costing_fn', '', true);
end $$;
revoke execute on function finalize_costing(uuid), reopen_costing(uuid) from public, anon;
grant execute on function finalize_costing(uuid), reopen_costing(uuid) to authenticated;

create trigger order_costing_audit after insert or update on order_costing for each row execute function audit_row();
create trigger album_lines_audit after insert or update on album_lines for each row execute function audit_row();
