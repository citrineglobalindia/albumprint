\set ON_ERROR_STOP on
\set QUIET on
-- Client proofing portal (anon RPCs), audit log_event, design state. Reuses the t.* harness created by 10_rules.sql.
create function t.anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub','',false); set role anon; end $$;
grant usage on schema t to anon; grant execute on all functions in schema t to anon;
create table t.p60(k text primary key, v text);
grant select, insert, update on t.p60 to authenticated, anon;

-- ───── fixture: an order waiting for client review ─────
select t.as('system');
insert into customers(studio_name, mobile) values ('Proof Studio', '9000000001');
insert into orders(customer_id, type, due_date, total, event_type) select id, 'design_printing', current_date + 10, 15000, 'Wedding' from customers where studio_name = 'Proof Studio';
insert into order_specs(order_id, album_type, album_size, orientation, pages, paper_type, cover_type, binding)
  select id, 'Premium', '12x36', 'landscape', 40, 'Matte', 'Leatherette', 'Lay-flat' from orders where customer_id = (select id from customers where studio_name = 'Proof Studio');
insert into t.p60 select 'order', id::text from orders where customer_id = (select id from customers where studio_name = 'Proof Studio');
insert into t.p60 select 'code', code from orders where id = (select v::uuid from t.p60 where k = 'order');
select advance_order((select v::uuid from t.p60 where k = 'order'), s::stage_key) from unnest(array['files_received','colour_grading','admin_approval','designing','client_review']) s;
select t.eq($$select stage::text from orders where id = (select v::uuid from t.p60 where k='order')$$, 'client_review', 'fixture order is in client review');

-- ───── staff create proofs (hash only) ─────
select t.as('designer');
select t.ok($$insert into proofs(order_id, version, token_hash, expires_at, status, approved_by) select v::uuid, 99, encode(sha256(convert_to('tok-one','UTF8')),'hex'), now() + interval '7 days', 'approved', 'Forged' from t.p60 where k='order'$$, 'designer inserts a proof (hash only)');
select t.eq($$select status || ':' || version || ':' || coalesce(approved_by,'-') from proofs where order_id = (select v::uuid from t.p60 where k='order')$$, 'sent:1:-', 'server forces status=sent, next version, no forged approval');
select t.err($$insert into proofs(order_id, token_hash, expires_at) select v::uuid, encode(sha256(convert_to('x','UTF8')),'hex'), now() + interval '200 days' from t.p60 where k='order'$$, 'proof expiry capped at 60 days', 'expiry');
select t.err($$insert into proofs(order_id, token_hash, expires_at) select v::uuid, 'tok-plain', now() + interval '2 days' from t.p60 where k='order'$$, 'a plain token cannot be stored (must be a sha-256 hash)', 'token_hash_fmt');
select t.err($$select token_hash from proofs$$, 'staff cannot read token hashes', 'permission denied');
select t.err($$update proofs set status = 'approved'$$, 'designer cannot approve a proof', 'revoked by staff|immutable|violates');
select t.as('admin');
select t.err($$update proofs set status = 'approved'$$, 'admin cannot forge a client approval', 'revoked by staff');
select t.err($$update proofs set token_hash = repeat('b', 64)$$, 'token hash is immutable', 'immutable');
select t.as('colour');
select t.err($$insert into proofs(order_id, token_hash, expires_at) select v::uuid, repeat('c', 64), now() + interval '2 days' from t.p60 where k='order'$$, 'colour grader cannot create proofs', 'row-level security');

-- ───── anonymous surface ─────
select t.anon();
select t.err($$select count(*) from proofs$$, 'anon cannot read proofs', 'permission denied');
select t.err($$select count(*) from orders$$, 'anon cannot read orders', 'permission denied');
select t.err($$select advance_order(gen_random_uuid(), 'designing')$$, 'anon cannot call advance_order', 'permission denied');
select t.err($$select log_event('design', 'x', 'y')$$, 'anon cannot call log_event', 'permission denied');
select t.err($$select proof_hash('tok-one')$$, 'anon cannot call the hash helper', 'permission denied');
select t.eq($$select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.prorettype <> 'trigger'::regtype and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')$$,
   'proof_get,proof_respond', 'the only functions anon may execute are proof_get and proof_respond');
select t.err($$select proof_get('no-such-token')$$, 'wrong token is refused', 'invalid_link');
select t.err($$select proof_get('')$$, 'empty token is refused', 'invalid_link');
select t.eq($$select (proof_get('tok-one')->'order'->>'code') || '/' || (proof_get('tok-one')->'order'->>'pages') || '/' || (proof_get('tok-one')->'proof'->>'version')$$, (select v from t.p60 where k = 'code') || '/40/1', 'valid token returns the order summary');
select t.eq($$select (proof_get('tok-one')::text ~* 'hash')::text$$, 'false', 'the response never contains the token hash');
select t.eq($$select (proof_get('tok-one')::text like '%' || encode(sha256(convert_to('tok-one','UTF8')),'hex') || '%')::text$$, 'false', 'the hash value is not in the response either');
select t.eq($$select proof_get('tok-one')->'proof'->>'status'$$, 'viewed', 'viewing marks the proof viewed');
select t.err($$select proof_respond('tok-one', 'delete', '[]', null)$$, 'unknown action is refused', 'invalid action');
select t.err($$select proof_respond('tok-one', 'corrections_requested', '[]', null)$$, 'corrections need at least one comment', 'at least one');
select t.err($$select proof_respond('tok-one', 'corrections_requested', '[{"page":2,"text":"x"}]', null)$$, 'too-short comment is refused', 'each correction');
select t.err($$select proof_respond('tok-one', 'approve', '[]', ' ')$$, 'approval needs a name', 'full name');
select t.err($$select proof_respond('wrong', 'approve', '[]', 'Someone')$$, 'wrong token cannot answer', 'invalid_link');

-- client asks for corrections → order returns to designing, server-side, with a reason
select t.eq($$select proof_respond('tok-one', 'corrections_requested', '[{"page":1,"text":"Brighten the cover"},{"page":12,"text":"Fix skin tone"}]', 'Client')->>'orderMoved'$$, 'true', 'client corrections recorded');
select t.err($$select proof_respond('tok-one', 'approve', '[]', 'Mr Client')$$, 'an answered link cannot be answered again', 'already_answered');
select t.eq($$select proof_get('tok-one')->'proof'->>'status'$$, 'corrections', 'answered link stays viewable as corrections');
select t.as('system');
select t.eq($$select stage::text from orders where id = (select v::uuid from t.p60 where k='order')$$, 'designing', 'order moved client_review → designing');
select t.eq($$select reason from audit_log where entity = 'orders' and entity_id = (select v from t.p60 where k='order') and new_data->>'stage' = 'designing' order by id desc limit 1$$, 'Client corrections', 'move is audited with the reason');
select t.eq($$select count(*)::text from proof_comments$$, '2', 'both comments stored');
select t.eq($$select count(*)::text from audit_log where entity = 'proofs' and action = 'update' and new_data->>'status' = 'corrections_requested' and new_data->>'client_note' = 'Client'$$, '1', 'client corrections audited by the proofs trigger');

-- staff see and work the corrections
select t.as('designer');
select t.eq($$select count(*)::text from proof_comments$$, '2', 'designer reads client comments');
select t.ok($$update proof_comments set resolved = true where page = 1$$, 'designer resolves a comment');
select t.err($$update proof_comments set text = 'rewritten'$$, 'client text cannot be edited', 'cannot be edited');
select t.as('accounts');
select t.eq($$select count(*)::text from proof_comments$$, '2', 'accounts can view (order view) but...');
select t.ok($$update proof_comments set resolved = false$$, 'accounts update matches no rows (no policy)');
select t.eq($$select count(*)::text from proof_comments where resolved$$, '1', '... and changed nothing');

-- ───── revoked / expired / approve → release gate ─────
select t.as('admin');
select t.ok($$select advance_order(v::uuid, 'client_review') from t.p60 where k='order'$$, 'designer re-submits; order back with client');
select t.ok($$insert into proofs(order_id, token_hash, expires_at) select v::uuid, encode(sha256(convert_to('tok-two','UTF8')),'hex'), now() + interval '7 days' from t.p60 where k='order'$$, 'v2 proof created');
select t.ok($$insert into proofs(order_id, token_hash, expires_at) select v::uuid, encode(sha256(convert_to('tok-rev','UTF8')),'hex'), now() + interval '7 days' from t.p60 where k='order'$$, 'v3 proof created');
select t.ok($$update proofs set status = 'revoked' where version = 3 and order_id = (select v::uuid from t.p60 where k='order')$$, 'admin revokes v3');
select t.as('system');
insert into proofs(order_id, version, token_hash, expires_at, status) select v::uuid, 4, encode(sha256(convert_to('tok-exp','UTF8')),'hex'), now() - interval '1 day', 'sent' from t.p60 where k='order';
select t.anon();
select t.err($$select proof_get('tok-rev')$$, 'revoked link is refused', 'link_revoked');
select t.err($$select proof_respond('tok-rev', 'approve', '[]', 'Mr Client')$$, 'revoked link cannot approve', 'link_revoked');
select t.err($$select proof_get('tok-exp')$$, 'expired link is refused', 'link_expired');
select t.err($$select proof_respond('tok-exp', 'approve', '[]', 'Mr Client')$$, 'expired link cannot approve', 'link_expired');
select t.as('admin');
select t.ok($$select advance_order(v::uuid, 'final_approval') from t.p60 where k='order'$$, 'client review → final approval');
select t.err($$select advance_order(v::uuid, 'printing') from t.p60 where k='order'$$, 'release blocked: no approved proof yet', 'final client approval');
select t.anon();
select t.err($$select proof_respond('tok-two', 'approve', '[]', 'X')$$, 'one-letter name refused', 'full name');
select t.eq($$select proof_respond('tok-two', 'approve', '[]', 'Mr Client')->>'status'$$, 'approved', 'client approves v2');
select t.err($$select proof_respond('tok-two', 'corrections_requested', '[{"page":1,"text":"too late"}]', null)$$, 'cannot change an approval', 'already_answered');
select t.as('admin');
select t.ok($$select advance_order(v::uuid, 'printing') from t.p60 where k='order'$$, 'approval unlocks release to printing');
select t.eq($$select approved_by from proofs where version = 2 and order_id = (select v::uuid from t.p60 where k='order')$$, 'Mr Client', 'approver name recorded');

-- ───── audit trail ─────
select t.as('designer');
select t.ok($$select log_event('design', (select v from t.p60 where k='code'), 'design_submitted', 'ready for review')$$, 'designer logs a design event');
select t.ok($$select log_event('design', (select v from t.p60 where k='code'), 'design_submitted', 'ready for review')$$, 'duplicate within a minute is idempotent');
select t.err($$select log_event('orders', 'x', 'update')$$, 'real table names are reserved for triggers', 'reserved');
select t.err($$select log_event('Bad Entity!', 'x', 'update')$$, 'entity is validated', 'invalid entity');
select t.err($$select log_event('design', 'x', repeat('a', 80))$$, 'action length-limited', 'invalid action');
select t.err($$select log_event('design', 'x', 'ok', repeat('a', 1001))$$, 'detail length-limited', 'too long');
select t.eq($$select count(*)::text from audit_log$$, '0', 'designer cannot read the audit log');
select t.as('admin');
select t.eq($$select count(*)::text || '/' || min(actor_role::text) from audit_log where entity = 'design' and action = 'design_submitted'$$, '1/designer', 'one row, stamped with the real actor role');
select t.eq($$select (actor = (select id from t.users where role = 'designer'))::text from audit_log where entity = 'design' and action = 'design_submitted'$$, 'true', 'actor is the signed-in user, not client-supplied');
select t.eq($$select count(*)::text from audit_log where (old_data::text || coalesce(new_data::text,'')) ~ 'token_hash'$$, '0', 'token hash never copied into the audit trail');
select t.eq($$select count(*)::text from audit_log where entity = 'proofs' and action = 'insert' and new_data->>'order_id' = (select v from t.p60 where k='order')$$, '4', 'proof creation is audited by trigger');
select t.err($$update audit_log set action = 'x'$$, 'audit log stays append-only', 'append-only|permission denied');
select t.as('reception');

-- ───── design state ─────
select t.as('designer');
select t.ok($$insert into design_docs(order_id, layout, meta) select v::uuid, '{"tpl":2,"spreads":[{"id":0,"overlays":[]}]}', '{"notes":[]}' from t.p60 where k='order'$$ , 'designer saves the layout');
select t.ok($$update design_docs set layout = '{"tpl":3,"spreads":[]}'$$, 'designer autosaves again');
select t.ok($$insert into design_corrections(order_id, code, page, text, by_name, assignee) select v::uuid, 'COR-001', 3, 'Crop tighter', 'Admin', 'Ramesh' from t.p60 where k='order'$$, 'designer adds a correction');
select t.as('admin');
select t.eq($$select layout->>'tpl' from design_docs$$, '3', 'admin sees the designer layout (shared)');
select t.ok($$update design_docs set meta = '{"adminApproved":true}'$$, 'admin updates review flags');
select t.eq($$select updated_by::text from design_docs$$, (select id::text from t.users where role = 'admin'), 'last editor is stamped by the server');
select t.as('reception');
select t.eq($$select count(*)::text from design_docs$$, '1', 'reception can view the layout');
select t.eq($$with u as (update design_docs set layout = '{}' returning 1) select count(*)::text from u$$, '0', 'reception cannot change the layout');
select t.err($$insert into design_corrections(order_id, code, page, text) select v::uuid, 'COR-002', 1, 'nope' from t.p60 where k='order'$$, 'reception cannot add design corrections', 'row-level security');
select t.as('accounts');
select t.eq($$select count(*)::text from design_docs$$, '0', 'accounts cannot see designs');
select t.as('system');
\echo PROOF + AUDIT + DESIGN TESTS PASSED
