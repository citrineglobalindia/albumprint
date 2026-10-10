-- Fixes from Supabase's security advisor (part 1: functions).

-- 1. Fixed search_path on every function that lacked one.
alter function next_code(text, text, int)   set search_path = public;
alter function touch_updated_at()           set search_path = public;
alter function audit_immutable()            set search_path = public;
alter function init_order()                 set search_path = public;
alter function payments_guard()             set search_path = public;
alter function invoice_lines_after()        set search_path = public;
alter function orders_protect()             set search_path = public;
alter function mask_text(text, int)         set search_path = public;
alter function guard_closed()               set search_path = public;
alter function guard_child_of_closed()      set search_path = public;
alter function file_version()               set search_path = public;
alter function file_lock_guard()            set search_path = public;
alter function is_system()                  set search_path = public;
alter function invoice_recompute(uuid)      set search_path = public;

-- 2. Internal trigger/helper functions are not part of the API: signed-in users may not call them directly.
--    (Triggers still fire; Postgres checks EXECUTE only when a trigger is created.)
revoke execute on function audit_row(), delivery_payment_gate(), invoice_discount_guard(), payments_after(), qc_sync(), set_codes(), recompute_payment_state(uuid),
  payments_guard(), invoice_lines_after(), orders_protect(), guard_closed(), guard_child_of_closed(), file_version(), file_lock_guard(),
  touch_updated_at(), audit_immutable(), init_order(), next_code(text, text, int) from authenticated, public, anon;
