-- Per-album assignment: who colour-grades and who designs each album of an order (job_progress.assignee, per album and department).
-- Admin and reception assign (any department); the assigned person is notified. Department staff keep updating their own rows (0056 policies).
alter table job_progress add column if not exists assignee uuid references profiles(id) on delete set null;

create or replace function assign_album_work(p_order uuid, p_album int, p_dept text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare code text; who text;
begin
  if current_app_role() is null or not (current_app_role() = 'admin' or has_perm('order', 'write')) then raise exception 'only admin or reception assigns work' using errcode = '42501'; end if;
  if p_dept not in ('grading', 'design', 'printing', 'qc', 'delivery') then raise exception 'unknown department %', p_dept using errcode = '22023'; end if;
  if p_album is null or p_album < 1 then raise exception 'choose an album' using errcode = '22023'; end if;
  select o.code into code from orders o where o.id = p_order;
  if not found then raise exception 'order not found'; end if;
  if p_user is not null and not exists (select 1 from profiles where id = p_user and active) then raise exception 'that person is not an active user' using errcode = '22023'; end if;
  insert into job_progress(order_id, album, dept, assignee) values (p_order, p_album, p_dept, p_user)
    on conflict (order_id, album, dept) do update set assignee = excluded.assignee;
  if p_user is not null and p_user is distinct from auth.uid() then
    select coalesce(nullif(title, ''), 'Album ' || p_album) into who from order_albums where order_id = p_order and position = p_album;
    insert into notifications(user_id, title, body, link)
      values (p_user, 'New work: ' || case p_dept when 'grading' then 'colour grading' when 'design' then 'designing' else p_dept end,
              code || ' · ' || coalesce(who, 'Album ' || p_album), '/orders/' || code);
  end if;
end $$;
revoke execute on function assign_album_work(uuid, int, text, uuid) from public, anon;
grant execute on function assign_album_work(uuid, int, text, uuid) to authenticated;
