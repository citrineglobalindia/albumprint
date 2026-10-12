\set ON_ERROR_STOP on
\set QUIET on
-- Audit rows carry the changed item's identity (0030). Reuses the t.* harness.
reset role;
create table t.p96 as select coalesce(max(id), 0) as mark from audit_log;
select t.as('system');
update profiles set active = true where id = (select id from t.users where role = 'admin');
select t.as('admin');
select t.ok($$update role_permissions set level = level where role = 'reception' and module = 'order'$$, 'audit ids: touch a permission cell');
select t.ok($$update settings set value = value where key = (select min(key) from settings)$$, 'audit ids: touch a setting');
select t.as('system');
select t.eq($$select (count(*) filter (where entity = 'role_permissions' and action = 'update' and entity_id is null))::text from audit_log where id > (select mark from t.p96)$$, '0', 'audit ids: permission changes name the role and module');
select t.eq($$select (count(*) filter (where entity = 'role_permissions' and entity_id = 'reception/order'))::text from audit_log where id > (select mark from t.p96)$$, '1', 'audit ids: the changed cell is reception/order');
select t.eq($$select (count(*) filter (where entity = 'settings' and action = 'update' and entity_id is null))::text from audit_log where id > (select mark from t.p96)$$, '0', 'audit ids: settings changes name the key');
\echo AUDIT ID TESTS PASSED
