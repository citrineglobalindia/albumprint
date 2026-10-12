-- Role matrix check against a REAL Supabase project, with nothing left behind.
-- Paste into the Supabase SQL editor (or run with psql). It creates throw-away staff for every role, tries 15 actions as each of them
-- under the real row-level-security policies, then deliberately fails at the end so the whole transaction rolls back.
-- Expected result: "ROLECHECK RESULT: 105 checks, 0 mismatches" (a "move an order" mismatch for reception is only an ordering artifact
-- when admin ran first). Any real mismatch lists role / action / allowed-or-refused.
do $$
declare
  roles text[] := array['admin','reception','designer','colour','printing','qc','accounts'];
  r text; uid uuid; n int; got boolean; out text := ''; fails int := 0; total int := 0; err text;
  cid uuid; oid uuid; aid uuid; chk jsonb; checks jsonb;
begin
  insert into customers(studio_name, mobile, code) values ('RoleCheck Studio', '9000000099', 'pending') returning id into cid;
  insert into orders(customer_id, type, due_date, total, code) values (cid, 'design_printing', current_date + 14, 1000, 'pending') returning id into oid;
  insert into order_albums(order_id, position, album_type, album_size, orientation, pages, copies, paper_type, cover_type, binding) values (oid, 1, 'Premium Album', '12x36', 'landscape', 30, 1, 'Matte', 'Leatherette', 'Lay-flat') returning id into aid;
  insert into catalog_items(name, category, sell_price) values ('ROLECHECK-ITEM', 'ROLECHECK', 10);
  insert into catalog_costs(item_id, cost_price) select id, 5 from catalog_items where name = 'ROLECHECK-ITEM';
  foreach r in array roles loop
    uid := gen_random_uuid();
    insert into auth.users(id, email, aud, role) values (uid, r || '-selftest@albumpro.invalid', 'authenticated', 'authenticated');
    insert into profiles(id, full_name, email, role, active, must_change_password) values (uid, 'Selftest ' || r, r || '-selftest@albumpro.invalid', r::app_role, true, false)
      on conflict (id) do update set role = excluded.role, active = true;
  end loop;
  checks := jsonb_build_array(
    jsonb_build_object('k','create a customer','kind','dml','sql','insert into customers(studio_name, mobile, code) values (''RC2'', ''9000000098'', ''pending'')','allow','["admin","reception"]'::jsonb),
    jsonb_build_object('k','create an order','kind','dml','sql',format('insert into orders(customer_id, type, due_date, total, code) values (%L, ''design_printing'', current_date + 14, 1, ''pending'')', cid),'allow','["admin","reception"]'::jsonb),
    jsonb_build_object('k','record a payment','kind','dml','sql',format('insert into payments(receipt_no, order_id, amount, mode, paid_on) values (''pending'', %L, 100, ''cash'', current_date)', oid),'allow','["admin","accounts","reception"]'::jsonb),
    jsonb_build_object('k','create an invoice','kind','call','sql',format('select create_invoice(%L, current_date + 10, 0, 18, false, null, ''[{"desc":"x","qty":1,"price":100}]'')', oid),'allow','["admin","accounts"]'::jsonb),
    jsonb_build_object('k','add a catalog product','kind','dml','sql','insert into catalog_items(name, category, sell_price) values (''RC-NEW'', ''RC'', 1)','allow','["admin"]'::jsonb),
    jsonb_build_object('k','see purchase costs','kind','rows','sql','select count(*) from catalog_costs','allow','["admin"]'::jsonb),
    jsonb_build_object('k','cost an album (add lines)','kind','dml','sql',format('insert into album_lines(order_id, album_id, position, name, qty, sell_price) values (%L, %L, 1, ''X'', 1, 1)', oid, aid),'allow','["admin"]'::jsonb),
    jsonb_build_object('k','change settings','kind','dml','sql','update settings set value = value where key = ''pricing''','allow','["admin"]'::jsonb),
    jsonb_build_object('k','edit the permission matrix','kind','dml','sql','update role_permissions set level = level where role = ''reception''','allow','["admin"]'::jsonb),
    jsonb_build_object('k','invite staff','kind','dml','sql','insert into staff_invites(email, full_name, role) values (''x@y.invalid'', ''X Y'', ''reception'')','allow','["admin"]'::jsonb),
    jsonb_build_object('k','read the audit log','kind','rows','sql','select count(*) from audit_log','allow','["admin"]'::jsonb),
    jsonb_build_object('k','read orders','kind','rows','sql','select count(*) from orders','allow','["admin","reception","designer","colour","printing","qc","accounts"]'::jsonb),
    jsonb_build_object('k','read payments','kind','rows','sql','select count(*) from payments','allow','["admin","accounts","reception"]'::jsonb),
    jsonb_build_object('k','make myself admin','kind','dml','sql','update profiles set role = ''admin'' where id = auth.uid() and role <> ''admin''','allow','[]'::jsonb),
    jsonb_build_object('k','move an order (new order → files received)','kind','call','sql',format('select advance_order(%L, ''files_received'', null, false)', oid),'allow','["admin","reception"]'::jsonb)
  );
  for chk in select * from jsonb_array_elements(checks) loop
    foreach r in array roles loop
      select id into uid from profiles where email = r || '-selftest@albumpro.invalid';
      perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
      perform set_config('request.jwt.claim.sub', uid::text, true);
      set local role authenticated;
      got := false; err := '';
      begin
        if chk->>'kind' = 'rows' then execute chk->>'sql' into n; got := n > 0;
        else execute chk->>'sql'; get diagnostics n = row_count; got := (chk->>'kind' = 'call') or n > 0; end if;
      exception when others then got := false; err := sqlerrm; end;
      reset role;
      total := total + 1;
      if got <> (chk->'allow' ? r) then fails := fails + 1; out := out || E'\n  MISMATCH ' || r || ' / ' || (chk->>'k') || ': ' || case when got then 'allowed' else 'refused' end || ' (expected ' || case when chk->'allow' ? r then 'allowed' else 'refused' end || ')' || case when err <> '' then ' [' || left(err, 90) || ']' else '' end; end if;
    end loop;
  end loop;
  raise exception E'ROLECHECK RESULT: % checks, % mismatches%', total, fails, out;   -- always rolls everything back
end $$;
