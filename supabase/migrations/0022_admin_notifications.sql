-- AlbumPro — notification triggers (SRS §17.1), communication-log updates and per-user bell notifications.
-- Sending to WhatsApp / e-mail / SMS providers is NOT implemented: outbound rows are recorded with status 'queued'.

create table if not exists notification_templates (
  key text primary key,
  name text not null,
  recipient text,
  behaviour text,
  body text,
  whatsapp boolean not null default true,
  email boolean not null default true,
  sms boolean not null default false,
  in_app boolean not null default true,
  active boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
alter table notification_templates enable row level security;
revoke all on notification_templates from anon, public;
grant select, insert, update, delete on notification_templates to authenticated;
create policy ntpl_read  on notification_templates for select to authenticated using (current_app_role() is not null);
create policy ntpl_write on notification_templates for all    to authenticated using (has_perm('users','write')) with check (has_perm('users','write'));
create or replace function ntpl_stamp() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger ntpl_stamp_t before update on notification_templates for each row execute function ntpl_stamp();
create trigger ntpl_audit after insert or update or delete on notification_templates for each row execute function audit_admin_row();

insert into notification_templates(key, name, recipient, behaviour, whatsapp, email, sort) values
 ('order_created','Order Created','Customer / Admin','Order acknowledgement with Order ID',true,true,1),
 ('colour_grading_assigned','Colour Grading Assigned','Colour Grader','New job notification',true,true,2),
 ('grading_submitted','Grading Submitted','Admin','Approval required',true,true,3),
 ('design_assigned','Design Assigned','Designer','New design task',true,true,4),
 ('design_submitted','Design Submitted','Admin','Review required',true,true,5),
 ('proof_ready','Proof Ready','Customer','Secure review link',true,true,6),
 ('correction_received','Correction Received','Admin / Designer','Correction task',true,false,7),
 ('final_approval','Final Approval','Admin / Printing','Release notification',true,true,8),
 ('printing_completed','Printing Completed','QC','QC job notification',true,true,9),
 ('qc_passed','QC Passed','Reception / Admin','Order ready for delivery',true,true,10),
 ('payment_due','Payment Due','Customer / Accounts','Reminder on configured schedule',true,true,11),
 ('dispatched','Dispatched','Customer','Courier / tracking details',true,true,12),
 ('delivered','Delivered','Customer / Admin','Delivery confirmation',true,true,13)
on conflict (key) do nothing;

-- ───────── communication log: staff who may message customers can retry (re-queue) a row ─────────
create policy comm_upd on comm_log for update to authenticated
  using (has_perm('order','write') or has_perm('client_proof','write')) with check (has_perm('order','write') or has_perm('client_proof','write'));
create index if not exists comm_log_order_idx on comm_log(order_id, sent_at desc);

-- ───────── bell notifications: one row per user, visible only to that user ─────────
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);
alter table notifications enable row level security;
revoke all on notifications from anon, public;
grant select, update on notifications to authenticated;
create policy notif_own_read on notifications for select to authenticated using (user_id = auth.uid());
create policy notif_own_upd  on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- fan a notification out to every active user holding one of the roles (called by triggers and by staff via rpc)
create or replace function notify_roles(p_roles app_role[], p_title text, p_body text default null, p_link text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and current_app_role() is null then raise exception 'not authorised' using errcode = '42501'; end if;
  insert into notifications(user_id, title, body, link) select id, p_title, p_body, p_link from profiles where active and role = any(p_roles);
end $$;
revoke execute on function notify_roles(app_role[], text, text, text) from public, anon;
grant execute on function notify_roles(app_role[], text, text, text) to authenticated;

-- client replies and failed messages reach Admin and Reception
create or replace function comm_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare code text;
begin
  select o.code into code from orders o where o.id = new.order_id;
  if new.direction = 'inbound' and tg_op = 'INSERT' then
    perform notify_roles(array['admin','reception']::app_role[], 'Client replied', coalesce(code || ': ', '') || coalesce(new.summary, ''), '/notifications');
  elsif new.status = 'failed' and (tg_op = 'INSERT' or old.status is distinct from 'failed') then
    perform notify_roles(array['admin','reception']::app_role[], 'Message failed', coalesce(code || ': ', '') || coalesce(new.summary, ''), '/notifications');
  end if;
  return new;
end $$;
create trigger comm_notify_t after insert or update of status on comm_log for each row execute function comm_notify();

-- a new staff member joining is worth an admin's attention
create or replace function profile_joined_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform notify_roles(array['admin']::app_role[], 'New staff member', new.full_name || ' joined as ' || new.role::text, '/users');
  return new;
end $$;
create trigger profile_joined_notify_t after insert on profiles for each row execute function profile_joined_notify();
