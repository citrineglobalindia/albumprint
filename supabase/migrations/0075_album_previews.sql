-- Album preview for clients: the designer uploads an album's pages (images, or a PDF turned into page images in the browser),
-- the client opens a private link (no login) and turns the pages like a real album, then approves it or asks for changes
-- (on a page or in general). Staff see the feedback on the order and mark it done.
--   album_previews            one uploaded version of an album; `token` is the client link, `folder` where its pages are stored
--   album_preview_feedback    the client's comments / change requests / approval
-- Pages live in the public bucket `album-previews` under a random folder (unguessable, like the link itself).
create table if not exists album_previews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  album int not null default 1 check (album >= 1),
  title text not null,
  version int not null default 1,
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  folder text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  pages int not null default 0 check (pages >= 0 and pages <= 400),
  spreads boolean not null default true,
  status text not null default 'shared' check (status in ('shared', 'approved', 'changes')),
  approved_by text, responded_at timestamptz,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists album_previews_order_idx on album_previews(order_id);

create table if not exists album_preview_feedback (
  id uuid primary key default gen_random_uuid(),
  preview_id uuid not null references album_previews(id) on delete cascade,
  page int check (page is null or page >= 1),
  name text check (name is null or length(name) <= 80),
  message text not null check (length(message) between 1 and 1000),
  kind text not null default 'changes' check (kind in ('comment', 'changes', 'approve')),
  resolved boolean not null default false,
  resolved_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists album_preview_feedback_preview_idx on album_preview_feedback(preview_id);

alter table album_previews enable row level security;
alter table album_preview_feedback enable row level security;
drop policy if exists ap_read on album_previews; drop policy if exists ap_ins on album_previews; drop policy if exists ap_upd on album_previews; drop policy if exists ap_del on album_previews;
create policy ap_read on album_previews for select to authenticated using (has_perm('order', 'view'));
create policy ap_ins  on album_previews for insert to authenticated with check (has_perm('design', 'write') or has_perm('order', 'write'));
create policy ap_upd  on album_previews for update to authenticated using (has_perm('design', 'write') or has_perm('order', 'write')) with check (true);
create policy ap_del  on album_previews for delete to authenticated using (current_app_role() = 'admin' or created_by = auth.uid());
drop policy if exists apf_read on album_preview_feedback; drop policy if exists apf_upd on album_preview_feedback;
create policy apf_read on album_preview_feedback for select to authenticated using (has_perm('order', 'view'));
create policy apf_upd  on album_preview_feedback for update to authenticated using (has_perm('design', 'write') or has_perm('order', 'write')) with check (true);
grant select, insert, update, delete on album_previews to authenticated;
grant select, update on album_preview_feedback to authenticated;
drop trigger if exists album_previews_audit on album_previews;
create trigger album_previews_audit after insert or update or delete on album_previews for each row execute function audit_row();

insert into storage.buckets (id, name, public, file_size_limit) values ('album-previews', 'album-previews', true, 15728640)
  on conflict (id) do nothing;
drop policy if exists album_previews_upload on storage.objects;
drop policy if exists album_previews_delete on storage.objects;
create policy album_previews_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'album-previews' and (has_perm('design', 'write') or has_perm('order', 'write')));
create policy album_previews_delete on storage.objects for delete to authenticated
  using (bucket_id = 'album-previews' and (current_app_role() = 'admin' or owner = auth.uid()));

-- the client's link: what to show (no login)
create or replace function album_preview_get(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p album_previews; o orders; c customers;
begin
  select * into p from album_previews where token = p_token;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  select * into o from orders where id = p.order_id;
  select * into c from customers where id = o.customer_id;
  return jsonb_build_object('title', p.title, 'version', p.version, 'pages', p.pages, 'spreads', p.spreads, 'folder', p.folder, 'status', p.status,
    'approved_by', p.approved_by, 'responded_at', p.responded_at, 'order_code', o.code, 'customer', coalesce(c.studio_name, ''), 'created_at', p.created_at,
    'feedback', coalesce((select jsonb_agg(jsonb_build_object('page', f.page, 'name', f.name, 'message', f.message, 'kind', f.kind, 'resolved', f.resolved, 'at', f.created_at) order by f.created_at)
                          from album_preview_feedback f where f.preview_id = p.id), '[]'::jsonb));
end $$;

-- the client's feedback: a comment / change request (optionally on a page), or the approval
create or replace function album_preview_feedback_add(p_token text, p_page int, p_name text, p_message text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p album_previews; n int;
begin
  select * into p from album_previews where token = p_token for update;
  if not found then raise exception 'this album link is not valid any more'; end if;
  if p_kind not in ('comment', 'changes', 'approve') then raise exception 'unknown feedback'; end if;
  if p_kind = 'approve' and p.status = 'approved' then raise exception 'this album is already approved'; end if;
  select count(*) into n from album_preview_feedback where preview_id = p.id;
  if n >= 300 then raise exception 'too many comments on this album — please call the studio'; end if;
  if p_page is not null and (p_page < 1 or p_page > greatest(p.pages, 1)) then raise exception 'no such page'; end if;
  insert into album_preview_feedback(preview_id, page, name, message, kind)
    values (p.id, p_page, nullif(left(btrim(coalesce(p_name, '')), 80), ''), left(coalesce(nullif(btrim(p_message), ''), case when p_kind = 'approve' then 'Approved' else '' end), 1000), p_kind);
  if p_kind = 'approve' then update album_previews set status = 'approved', approved_by = nullif(left(btrim(coalesce(p_name, '')), 80), ''), responded_at = now() where id = p.id;
  elsif p_kind = 'changes' and p.status <> 'approved' then update album_previews set status = 'changes', responded_at = now() where id = p.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function album_preview_get(text) from public;
revoke execute on function album_preview_feedback_add(text, int, text, text, text) from public;
grant execute on function album_preview_get(text) to anon, authenticated;
grant execute on function album_preview_feedback_add(text, int, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
