-- The immutability trigger function gets a fixed search_path (security advisor).
alter function attendance_events_immutable() set search_path = public;
