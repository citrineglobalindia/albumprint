\set ON_ERROR_STOP on
\set QUIET on
-- Scheduled reports (0031). Reuses the t.* harness.
reset role;
select t.as('system');
update profiles set active = true where id = (select id from t.users where role = 'admin');
select t.as('reception');
select t.err($$insert into report_schedules(name, freq, run_time, recipients) values ('x', 'Daily', '09:00', array['a@b.co'])$$, 'schedules: reception cannot create one', 'row-level');
select t.as('admin');
select t.ok($$insert into report_schedules(name, freq, day, run_time, format, recipients) values ('Weekly sales', 'Weekly', 'Monday', '09:00', 'Excel', array['reception@albumpro.local'])$$, 'schedules: admin creates a weekly one');
select t.err($$insert into report_schedules(name, freq, run_time, recipients) values ('bad', 'Daily', '25:99', array['a@b.co'])$$, 'schedules: bad time refused', 'check');
select t.err($$insert into report_schedules(name, freq, run_time, recipients) values ('bad', 'Hourly', '09:00', array['a@b.co'])$$, 'schedules: unknown frequency refused', 'check');
select t.as('system');
-- due-time maths (Asia/Kolkata): Wed 2026-10-14 10:00 IST; Daily 09:00 -> same day; Weekly Monday 09:00 -> 2026-10-12; Monthly 15th -> 2026-10-15 not yet -> 2026-09-15
select t.eq($$select to_char(report_schedule_due(row(null,'n','r','{}',null,'{}','Daily',null,'09:00','CSV','{a}',true,now(),null,now())::report_schedules, '2026-10-14 10:00+05:30') at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')$$, '2026-10-14 09:00', 'due: daily after its time is today');
select t.eq($$select to_char(report_schedule_due(row(null,'n','r','{}',null,'{}','Daily',null,'11:00','CSV','{a}',true,now(),null,now())::report_schedules, '2026-10-14 10:00+05:30') at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')$$, '2026-10-13 11:00', 'due: daily before its time is yesterday');
select t.eq($$select to_char(report_schedule_due(row(null,'n','r','{}',null,'{}','Weekly','Monday','09:00','CSV','{a}',true,now(),null,now())::report_schedules, '2026-10-14 10:00+05:30') at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')$$, '2026-10-12 09:00', 'due: weekly Monday is the most recent Monday');
select t.eq($$select to_char(report_schedule_due(row(null,'n','r','{}',null,'{}','Monthly','15th','09:00','CSV','{a}',true,now(),null,now())::report_schedules, '2026-10-14 10:00+05:30') at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')$$, '2026-09-15 09:00', 'due: monthly 15th before the 15th is last month');
select t.eq($$select to_char(report_schedule_due(row(null,'n','r','{}',null,'{}','Monthly','Last day','09:00','CSV','{a}',true,now(),null,now())::report_schedules, '2026-10-14 10:00+05:30') at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')$$, '2026-09-30 09:00', 'due: monthly last day');
-- the job: a schedule whose last run is older than its due moment notifies admin + recipient once
update report_schedules set last_run_at = now() - interval '8 days';
select t.eq($$select run_report_schedules()::text$$, '1', 'job: one schedule came due');
select t.ok($$select 1 from notifications where title like 'Scheduled report ready: Weekly sales%' having count(*) >= 2$$, 'job: admin and the recipient were notified');
select t.eq($$select run_report_schedules()::text$$, '0', 'job: it does not fire twice for the same due moment');
\echo SCHEDULE TESTS PASSED
