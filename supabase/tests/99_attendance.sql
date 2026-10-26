\set ON_ERROR_STOP on
\set QUIET on
-- Attendance ledger (0033). Reuses the t.* harness.
reset role;
select t.as('system');
update profiles set active = true where id in (select id from t.users where role in ('admin', 'reception', 'designer'));
select t.as('reception');
select t.err($$select attendance_punch('check_out')$$, 'attendance: cannot check out before checking in', 'Check in first');
select t.err($$select attendance_punch('break_start')$$, 'attendance: cannot start a break before checking in', 'Check in first');
select t.err($$select attendance_punch('lunch')$$, 'attendance: unknown action refused', 'unknown');
select t.ok($$select attendance_punch('check_in', 'morning')$$, 'attendance: check in');
select t.err($$select attendance_punch('check_in')$$, 'attendance: no double check-in', 'already checked in');
select t.err($$select attendance_punch('break_end')$$, 'attendance: cannot end a break that did not start', 'not on a break');
select t.ok($$select attendance_punch('break_start')$$, 'attendance: start a break');
select t.err($$select attendance_punch('check_out')$$, 'attendance: cannot check out while on a break', 'End your break');
select t.err($$select attendance_punch('break_start')$$, 'attendance: no double break', 'already on a break');
select t.ok($$select attendance_punch('break_end')$$, 'attendance: end the break');
select t.ok($$select attendance_punch('check_out', 'done')$$, 'attendance: check out');
select t.err($$select attendance_punch('check_out')$$, 'attendance: no double check-out', 'already checked out');
select t.ok($$select attendance_punch('check_in', 'back for the evening')$$, 'attendance: a second session the same day is allowed');
select t.eq($$select count(*)::text from attendance_events$$, '5', 'attendance: reception sees her own five rows');
-- append-only: no direct writes, even for the owner of the row
select t.err($$insert into attendance_events(user_id, kind) values (auth.uid(), 'check_in')$$, 'attendance: no direct insert', 'permission denied');
select t.err($$update attendance_events set at = at - interval '3 hours'$$, 'attendance: no direct update', 'permission denied');
select t.err($$delete from attendance_events$$, 'attendance: no direct delete', 'permission denied');
-- privacy: another employee sees none of it; admin sees everyone
select t.as('designer');
select t.eq($$select count(*)::text from attendance_events$$, '0', 'attendance: a colleague cannot read someone else''s punches');
select t.ok($$select attendance_punch('check_in')$$, 'attendance: the designer checks in');
select t.err($$select attendance_adjust(auth.uid(), current_date - 1, '09:00', '18:00', 'self fix')$$, 'attendance: staff cannot correct attendance', 'administrator');
select t.as('admin');
select t.eq($$select count(*)::text from attendance_events$$, '6', 'attendance: admin sees every employee''s rows');
-- corrections: reason required, no future dates, sane times
select t.err($$select attendance_adjust((select id from t.users where role = 'reception'), current_date - 1, '09:00', '18:00', '')$$, 'attendance: a correction needs a reason', 'reason');
select t.err($$select attendance_adjust((select id from t.users where role = 'reception'), current_date + 1, '09:00', '18:00', 'future')$$, 'attendance: no future attendance', 'future');
select t.err($$select attendance_adjust((select id from t.users where role = 'reception'), current_date - 1, '18:00', '09:00', 'backwards')$$, 'attendance: check-out must follow check-in', 'after');
select t.err($$select attendance_adjust((select id from t.users where role = 'reception'), current_date - 1, null, '09:00', 'no in')$$, 'attendance: check-out alone refused', 'check-in time');
select t.eq($$select attendance_adjust((select id from t.users where role = 'reception'), current_date - 1, '09:30', '18:15', 'forgot to punch')::text$$, '2', 'attendance: admin records a missed day (two rows)');
select t.eq($$select to_char(at at time zone 'Asia/Kolkata', 'HH24:MI') from attendance_events where user_id = (select id from t.users where role = 'reception') and work_date = current_date - 1 and kind = 'check_out' and superseded_at is null$$, '18:15', 'attendance: the correction is stored in IST');
select t.eq($$select attendance_adjust((select id from t.users where role = 'reception'), current_date - 1, '10:00', '17:00', 'fixed again')::text$$, '2', 'attendance: correcting again supersedes the first correction');
select t.eq($$select count(*)::text from attendance_events where user_id = (select id from t.users where role = 'reception') and work_date = current_date - 1$$, '4', 'attendance: the superseded rows are kept for the record');
select t.eq($$select count(*)::text from attendance_events where user_id = (select id from t.users where role = 'reception') and work_date = current_date - 1 and superseded_at is null$$, '2', 'attendance: only the latest correction counts');
select t.ok($$select 1 from audit_log where entity = 'attendance_events' and reason is null having count(*) >= 4$$, 'attendance: corrections are audited');
-- the ledger cannot be edited or deleted even by a superuser-level path
select t.as('system');
select t.err($$update attendance_events set kind = 'check_out' where kind = 'check_in'$$, 'attendance: rows cannot be edited', 'cannot be edited');
select t.err($$delete from attendance_events$$, 'attendance: rows cannot be deleted', 'cannot be deleted');
-- settings
select t.as('reception');
select t.eq($$select to_char(shift_start, 'HH24:MI') from attendance_settings$$, '09:30', 'settings: everyone can read the shift');
select t.eq($$with u as (update attendance_settings set grace_minutes = 99 returning 1) select count(*)::text from u$$, '0', 'settings: reception cannot change them');
select t.as('admin');
select t.eq($$with u as (update attendance_settings set grace_minutes = 10, weekly_off = '{0,6}' returning 1) select count(*)::text from u$$, '1', 'settings: admin changes them');
select t.err($$update attendance_settings set half_day_hours = 9, full_day_hours = 8$$, 'settings: half day cannot exceed full day', 'check');
select t.err($$update attendance_settings set weekly_off = '{7}'$$, 'settings: weekday numbers are 0-6', 'check');
-- leave
select t.as('reception');
select t.ok($$insert into attendance_leaves(from_date, to_date, kind, reason) values (current_date + 5, current_date + 6, 'Casual', 'family function')$$, 'leave: request two days');
select t.err($$insert into attendance_leaves(from_date, to_date, kind, reason) values (current_date + 6, current_date + 8, 'Sick', 'overlap')$$, 'leave: overlapping request refused', 'already have');
select t.err($$insert into attendance_leaves(from_date, to_date, kind, reason) values (current_date + 20, current_date + 19, 'Casual', 'backwards')$$, 'leave: end before start refused', 'check');
select t.err($$insert into attendance_leaves(from_date, to_date, kind, reason) values (current_date + 20, current_date + 21, 'Half day', 'two days')$$, 'leave: half day must be a single day', 'check');
select t.err($$insert into attendance_leaves(user_id, from_date, to_date, kind, reason) values ((select id from t.users where role = 'designer'), current_date + 30, current_date + 30, 'Casual', 'for someone else')$$, 'leave: cannot file for another person', 'row-level');
select t.err($$insert into attendance_leaves(from_date, to_date, kind, reason, status) values (current_date + 40, current_date + 40, 'Casual', 'self approve', 'approved')$$, 'leave: cannot approve your own', 'row-level');
select t.err($$select attendance_leave_decide((select id from attendance_leaves limit 1), true)$$, 'leave: reception cannot decide', 'administrator');
select t.as('admin');
select t.ok($$select 1 from notifications where title like 'Leave request:%' having count(*) >= 1$$, 'leave: the admin was told');
select t.ok($$select attendance_leave_decide((select id from attendance_leaves where reason = 'family function'), true, 'enjoy')$$, 'leave: admin approves');
select t.err($$select attendance_leave_decide((select id from attendance_leaves where reason = 'family function'), false)$$, 'leave: cannot decide twice', 'already approved');
select t.ok($$select 1 from notifications where title = 'Leave approved' and body like '%enjoy%'$$, 'leave: the employee was told');
select t.as('reception');
select t.err($$select attendance_leave_cancel((select id from attendance_leaves where reason = 'family function'))$$, 'leave: an approved request cannot be cancelled by the employee', 'pending');
select t.as('designer');
select t.eq($$select count(*)::text from attendance_leaves$$, '0', 'leave: a colleague cannot see it');
\echo ATTENDANCE TESTS PASSED
