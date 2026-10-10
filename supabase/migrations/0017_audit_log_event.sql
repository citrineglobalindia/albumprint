-- Audit trail, part 2: (a) client-side events that have no table trigger go through log_event(); (b) secrets never reach the trail.

-- Proof token hashes must not be copied into audit rows (the proofs row trigger would otherwise store them in old_data/new_data).
create or replace function audit_redact() returns trigger language plpgsql set search_path = public as $$
begin
  if new.entity = 'proofs' then
    new.old_data := case when new.old_data is null then null else new.old_data - 'token_hash' end;
    new.new_data := case when new.new_data is null then null else new.new_data - 'token_hash' end;
  end if;
  return new;
end $$;
create trigger audit_redact_t before insert on audit_log for each row execute function audit_redact();
revoke execute on function audit_redact() from public, anon, authenticated;

create index if not exists audit_log_at_idx on audit_log (at desc);

-- log_event: signed-in staff record a business event that no table trigger sees (proof/design/production notes, SLA nudges …).
-- The server stamps actor and role; the client cannot choose them. Idempotent per (actor, entity, entity_id, action, detail) within a minute.
-- Entity names equal to a real table are refused so a client cannot forge the rows that triggers write.
create or replace function log_event(p_entity text, p_entity_id text, p_action text, p_detail text default null, p_reason text default null,
                                     p_from text default null, p_to text default null, p_override boolean default false)
returns bigint language plpgsql security definer set search_path = public as $$
declare r app_role := current_app_role(); a uuid := auth.uid(); nd jsonb; n bigint;
begin
  if r is null then raise exception 'not authorised' using errcode = '42501'; end if;
  p_entity := btrim(coalesce(p_entity, '')); p_action := btrim(coalesce(p_action, ''));
  if p_entity !~ '^[a-z][a-z0-9_]{0,39}$' then raise exception 'invalid entity'; end if;
  if p_action !~ '^[a-z0-9][a-z0-9_ .:-]{0,59}$' then raise exception 'invalid action'; end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = p_entity) then raise exception 'entity % is reserved for automatic auditing', p_entity; end if;
  if length(coalesce(p_entity_id, '')) > 100 or length(coalesce(p_detail, '')) > 1000 or length(coalesce(p_reason, '')) > 1000
     or length(coalesce(p_from, '')) > 200 or length(coalesce(p_to, '')) > 200 then raise exception 'value too long'; end if;
  nd := jsonb_strip_nulls(jsonb_build_object('source', 'client', 'detail', p_detail, 'from', p_from, 'to', p_to, 'override', case when p_override then true end));
  select id into n from audit_log
   where actor = a and entity = p_entity and entity_id is not distinct from p_entity_id and action = p_action
     and new_data is not distinct from nd and reason is not distinct from nullif(p_reason, '') and at > now() - interval '1 minute' limit 1;
  if n is not null then return n; end if;
  insert into audit_log(actor, actor_role, entity, entity_id, action, new_data, reason)
  values (a, r, p_entity, p_entity_id, p_action, nd, nullif(p_reason, '')) returning id into n;
  return n;
end $$;
revoke execute on function log_event(text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function log_event(text, text, text, text, text, text, text, boolean) to authenticated;
