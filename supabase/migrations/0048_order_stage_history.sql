-- An order's stage history (which stage, who moved it, when) for the order page's process tracker.
-- The audit log itself stays admin-only; this returns just the stage moves of one order, to signed-in staff.
create or replace function order_stage_history(p_order uuid) returns table(stage text, at timestamptz, actor_name text, actor_role text, reason text)
language sql stable security definer set search_path = public as $$
  select a.new_data->>'stage', a.at, coalesce(p.full_name, 'System'), coalesce(a.actor_role::text, 'system'), a.reason
  from audit_log a left join profiles p on p.id = a.actor
  where current_app_role() is not null
    and a.entity = 'orders' and a.entity_id = p_order::text and a.action in ('update', 'insert')
    and (a.action = 'insert' or a.old_data->>'stage' is distinct from a.new_data->>'stage')
  order by a.at, a.id
$$;
revoke execute on function order_stage_history(uuid) from public, anon;
grant execute on function order_stage_history(uuid) to authenticated;
