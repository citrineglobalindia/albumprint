\set ON_ERROR_STOP on
\set QUIET on
do $$
declare rec uuid := gen_random_uuid(); col uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); n int; ok boolean;
begin
  insert into auth.users(id, email) values (rec, 'rec@s.test'), (col, 'col@s.test'), (acc, 'acc@s.test');
  insert into profiles(id, full_name, email, role, must_change_password) values (rec,'Rec','rec@s.test','reception',false),(col,'Col','col@s.test','colour',false),(acc,'Acc','acc@s.test','accounts',false);
  -- reception uploads
  perform set_config('request.jwt.claim.sub', rec::text, true); set local role authenticated;
  insert into storage.objects(bucket_id, name) values ('order-files', 'IDP00001/source_photos/a.jpg-v1');
  reset role; raise notice 'ok   - reception can upload to the order-files bucket';
  -- colour grader (production work) uploads; accounts cannot
  perform set_config('request.jwt.claim.sub', col::text, true); set local role authenticated;
  insert into storage.objects(bucket_id, name) values ('order-files', 'IDP00001/graded/b.jpg-v1');
  reset role; raise notice 'ok   - colour grader can upload graded files';
  perform set_config('request.jwt.claim.sub', acc::text, true); set local role authenticated;
  ok := false; begin insert into storage.objects(bucket_id, name) values ('order-files', 'IDP00001/other/x'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL - accounts uploaded a file'; end if;
  select count(*) into n from storage.objects where bucket_id = 'order-files';
  reset role; raise notice 'ok   - accounts cannot upload (but may read: % objects visible)', n;
  -- nobody can overwrite or delete stored files
  perform set_config('request.jwt.claim.sub', rec::text, true); set local role authenticated;
  update storage.objects set name = 'hacked' where bucket_id = 'order-files'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL - object renamed'; end if;
  reset role; raise notice 'ok   - stored files cannot be modified';
  -- anon sees nothing
  set local role anon; ok := false; begin perform count(*) from storage.objects; exception when others then ok := true; end; reset role;
  if not ok then raise exception 'FAIL - anon can read storage objects'; end if;
  raise notice 'ok   - anonymous users cannot read files';
end $$;
\echo STORAGE TESTS PASSED
