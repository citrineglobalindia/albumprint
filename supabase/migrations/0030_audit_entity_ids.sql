-- Audit rows must say WHICH item changed: permission-matrix cells (role/module), settings (key), costs (item or line), not just the table.
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log(actor, actor_role, entity, entity_id, action, old_data, new_data, reason)
  values (auth.uid(), current_app_role(), tg_table_name,
          coalesce(j->>'id', j->>'order_id', j->>'key', j->>'line_id', j->>'item_id', case when j ? 'role' and j ? 'module' then (j->>'role') || '/' || (j->>'module') end),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end,
          nullif(current_setting('app.reason', true), ''));
  return coalesce(new, old);
end $$;
create or replace function audit_admin_row() returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log(actor, actor_role, entity, entity_id, action, old_data, new_data, reason)
  values (auth.uid(), current_app_role(), tg_table_name,
          coalesce(j->>'id', j->>'key', j->>'stage', j->>'email', j->>'sku', j->>'item_id', j->>'line_id', case when j ? 'role' and j ? 'module' then (j->>'role') || '/' || (j->>'module') end),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end, nullif(current_setting('app.reason', true), ''));
  return coalesce(new, old);
end $$;
revoke execute on function audit_row(), audit_admin_row() from public, anon, authenticated;
-- purchase prices are the shop's margin: every change is recorded
create trigger catalog_costs_audit    after insert or update on catalog_costs    for each row execute function audit_admin_row();
create trigger album_line_costs_audit after insert or update on album_line_costs for each row execute function audit_admin_row();
