-- Where the finished work is kept: a folder path or drive link per order / album and department (e.g. the graded photos' folder),
-- set by the people doing the work (job_progress write policies, 0056) and shown to the next department.
alter table job_progress add column if not exists files_path text check (files_path is null or length(files_path) <= 500);
