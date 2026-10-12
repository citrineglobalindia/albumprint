-- Work group on an order (Photo Book, Amateur, Professional, Rework, Company Mistakes).
alter table orders add column if not exists work_group text check (work_group is null or char_length(btrim(work_group)) between 1 and 60);
