-- Client proofing without a login: public RPCs (anon) over a token whose SHA-256 hash is the only thing stored.
grant usage on schema public to anon;   -- Supabase default; explicit so plain Postgres setups match

alter table proofs
  add column if not exists viewed_at timestamptz,
  add column if not exists approved_by text,
  add column if not exists sent_via text not null default 'Link' check (sent_via in ('WhatsApp','Email','Link'));
alter table proofs add constraint proofs_token_hash_fmt check (token_hash ~ '^[0-9a-f]{64}$') not valid;
create index if not exists proofs_order_idx on proofs(order_id, version desc);

create table proof_comments (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null references proofs(id),
  page int not null check (page between 1 and 999),
  text text not null check (char_length(text) between 3 and 2000),
  at timestamptz not null default now(),
  resolved boolean not null default false,
  in_progress boolean not null default false,
  resolved_by uuid references profiles(id),
  resolved_at timestamptz
);
create index proof_comments_proof_idx on proof_comments(proof_id);
alter table proof_comments enable row level security;
grant select, update on proof_comments to authenticated;     -- inserts happen only inside proof_respond()
create policy pcomm_read on proof_comments for select to authenticated using (has_perm('client_correction','view') or has_perm('order','view'));
create policy pcomm_upd  on proof_comments for update to authenticated using (has_perm('client_correction','write') or has_perm('design','write'))
                                                                      with check (has_perm('client_correction','write') or has_perm('design','write'));

-- Staff may never read the token hash: column-level select grant without it.
revoke select on proofs from authenticated;
grant select (id, order_id, version, expires_at, status, responded_at, client_note, sent_by, sent_at, viewed_at, approved_by, sent_via) on proofs to authenticated;

-- Designers send proofs from Album Designing; reception/admin via client_proof. (Triggers below restrict what a write can do.)
create policy proofs_design_ins on proofs for insert to authenticated with check (has_perm('design','write'));
create policy proofs_design_upd on proofs for update to authenticated using (has_perm('design','write')) with check (has_perm('design','write'));
create policy proofs_read_corr  on proofs for select to authenticated using (has_perm('client_correction','view'));

-- Staff can only create a fresh 'sent' proof or revoke a live one. Approval / views / corrections come only from the portal functions.
create or replace function proofs_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare viaFn boolean := coalesce(current_setting('app.proof_fn', true), '') = '1';
begin
  if viaFn or is_system() then
    if tg_op = 'INSERT' and new.version is null then new.version := 1; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.expires_at <= now() or new.expires_at > now() + interval '61 days' then raise exception 'proof expiry must be within 60 days'; end if;
    new.status := 'sent'; new.responded_at := null; new.viewed_at := null; new.approved_by := null; new.client_note := null;
    new.sent_by := auth.uid(); new.sent_at := now();
    select coalesce(max(version), 0) + 1 into new.version from proofs where order_id = new.order_id;
    return new;
  end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then raise exception 'proofs are immutable; create a new version instead' using errcode = '42501'; end if;
  if new.status is distinct from old.status and not (old.status in ('sent','viewed') and new.status = 'revoked') then
    raise exception 'a proof can only be revoked by staff; the client answers it from the portal' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger proofs_guard_t before insert or update on proofs for each row execute function proofs_guard();
revoke execute on function proofs_guard() from public, anon, authenticated;

create or replace function proof_comments_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_system() then return new; end if;
  if (to_jsonb(new) - 'resolved' - 'in_progress' - 'resolved_by' - 'resolved_at') is distinct from (to_jsonb(old) - 'resolved' - 'in_progress' - 'resolved_by' - 'resolved_at') then
    raise exception 'client comments cannot be edited' using errcode = '42501';
  end if;
  new.resolved_by := case when new.resolved then auth.uid() end;
  new.resolved_at := case when new.resolved then coalesce(old.resolved_at, now()) end;
  return new;
end $$;
create trigger proof_comments_guard_t before update on proof_comments for each row execute function proof_comments_guard();
revoke execute on function proof_comments_guard() from public, anon, authenticated;

-- ───────── public RPCs ─────────
create or replace function proof_hash(t text) returns text language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(coalesce(t, ''), 'UTF8')), 'hex') $$;
revoke execute on function proof_hash(text) from public, anon, authenticated;

-- Returns the proof + a safe order summary for a live link and records the first view.
create or replace function proof_get(token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare p proofs; o record; st text; cm jsonb;
begin
  select * into p from proofs where token_hash = proof_hash(token);
  if not found then raise exception 'invalid_link'; end if;
  if p.status = 'revoked' then raise exception 'link_revoked'; end if;
  if p.status in ('sent','viewed') and p.expires_at < now() then raise exception 'link_expired'; end if;
  if p.status = 'sent' then
    perform set_config('app.proof_fn', '1', true);
    update proofs set status = 'viewed', viewed_at = now() where id = p.id returning * into p;
    perform set_config('app.proof_fn', '', true);
  end if;
  select o2.code, coalesce(o2.event_type, o2.event_name) as event, c.studio_name as studio, s.album_size as size, s.pages
    into o from orders o2 join customers c on c.id = o2.customer_id left join order_specs s on s.order_id = o2.id where o2.id = p.order_id;
  select coalesce(jsonb_agg(jsonb_build_object('page', page, 'text', text, 'at', at) order by at, page), '[]') into cm from proof_comments where proof_id = p.id;
  return jsonb_build_object(
    'proof', jsonb_build_object('version', p.version, 'status', case p.status when 'corrections_requested' then 'corrections' else p.status end, 'sentVia', p.sent_via,
             'expiresAt', p.expires_at, 'viewedAt', p.viewed_at, 'respondedAt', p.responded_at, 'approvedBy', p.approved_by, 'comments', cm),
    'order', jsonb_build_object('code', o.code, 'event', coalesce(o.event, 'Album'), 'studio', o.studio, 'size', coalesce(o.size, ''), 'pages', coalesce(o.pages, 0)));
end $$;

-- The proofs row trigger audits the answer (approved_by / client_note carry the client's name); the order move is audited by advance_order.
-- action: 'approve' (name required) or 'corrections_requested' (comments: [{page, text}]). One answer per link.
create or replace function proof_respond(token text, action text, comments jsonb default '[]', name text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare p proofs; nm text := btrim(coalesce(name, '')); c jsonb; n int := 0; moved boolean := false;
begin
  if action not in ('approve','corrections_requested') then raise exception 'invalid action'; end if;
  select * into p from proofs where token_hash = proof_hash(token) for update;
  if not found then raise exception 'invalid_link'; end if;
  if p.status = 'revoked' then raise exception 'link_revoked'; end if;
  if p.status in ('approved','corrections_requested') then raise exception 'already_answered'; end if;
  if p.expires_at < now() then raise exception 'link_expired'; end if;
  perform set_config('app.proof_fn', '1', true);
  if action = 'approve' then
    if char_length(nm) < 2 or char_length(nm) > 120 then raise exception 'please provide your full name'; end if;
    update proofs set status = 'approved', responded_at = now(), approved_by = nm, viewed_at = coalesce(viewed_at, now()) where id = p.id;
  else
    if jsonb_typeof(comments) <> 'array' or jsonb_array_length(comments) not between 1 and 50 then raise exception 'at least one correction is required (max 50)'; end if;
    for c in select * from jsonb_array_elements(comments) loop
      if jsonb_typeof(c) <> 'object' or (c->>'page') !~ '^[0-9]{1,3}$' or (c->>'page')::int < 1 or char_length(btrim(coalesce(c->>'text', ''))) not between 3 and 2000 then
        raise exception 'each correction needs a page and 3-2000 characters of text'; end if;
      insert into proof_comments(proof_id, page, text) values (p.id, (c->>'page')::int, btrim(c->>'text')); n := n + 1;
    end loop;
    update proofs set status = 'corrections_requested', responded_at = now(), client_note = nullif(nm, ''), viewed_at = coalesce(viewed_at, now()) where id = p.id;
    -- the order goes back to the designer (system context, with a reason)
    if exists (select 1 from orders where id = p.order_id and stage = 'client_review') then
      begin
        perform advance_order(p.order_id, 'designing', 'Client corrections', false); moved := true;
      exception when others then moved := false;     -- e.g. order on hold: corrections are still recorded
      end;
    end if;
  end if;
  perform set_config('app.proof_fn', '', true);
  return jsonb_build_object('status', case action when 'approve' then 'approved' else 'corrections' end, 'orderMoved', moved);
end $$;

-- Only these two functions are reachable without a login.
revoke execute on function proof_get(text), proof_respond(text, text, jsonb, text) from public;
grant execute on function proof_get(text), proof_respond(text, text, jsonb, text) to anon, authenticated;
