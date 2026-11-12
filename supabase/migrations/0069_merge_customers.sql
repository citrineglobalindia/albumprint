-- Merge duplicate customers (the same studio saved more than once, e.g. typed again as a new customer with the same mobile).
-- Admin only. Every order, invoice and message of the duplicates moves to the customer kept; details the kept record lacks
-- (email, address, contact, GSTIN, city...) are taken from the duplicates; the duplicates are deleted (the audit log keeps them).
create or replace function merge_customers(p_keep uuid, p_merge uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare keep customers; d customers; n_orders int := 0; n_inv int := 0; c int; merged int := 0;
begin
  if current_app_role() is distinct from 'admin' then raise exception 'only an admin merges customers' using errcode = '42501'; end if;
  select * into keep from customers where id = p_keep for update;
  if not found then raise exception 'the customer to keep was not found'; end if;
  perform set_config('app.allow_closed', '1', true);
  for d in select * from customers where id = any(p_merge) and id <> p_keep for update loop
    update orders set customer_id = p_keep where customer_id = d.id; get diagnostics c = row_count; n_orders := n_orders + c;
    update invoices set customer_id = p_keep where customer_id = d.id; get diagnostics c = row_count; n_inv := n_inv + c;
    update comm_log set customer_id = p_keep where customer_id = d.id;
    update customers set
      email = coalesce(keep.email, d.email), address = coalesce(keep.address, d.address), contact_person = coalesce(keep.contact_person, d.contact_person),
      whatsapp = coalesce(keep.whatsapp, d.whatsapp), city = coalesce(keep.city, d.city), state = coalesce(keep.state, d.state), gstin = coalesce(keep.gstin, d.gstin)
    where id = p_keep returning * into keep;
    delete from customers where id = d.id;
    merged := merged + 1;
  end loop;
  perform set_config('app.allow_closed', '', true);
  return jsonb_build_object('kept', keep.code, 'merged', merged, 'orders', n_orders, 'invoices', n_inv);
end $$;
revoke execute on function merge_customers(uuid, uuid[]) from public, anon;
grant execute on function merge_customers(uuid, uuid[]) to authenticated;
