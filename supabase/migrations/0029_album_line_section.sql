-- Which part of the album a costing line belongs to: front cover, inside pages, back cover, or a custom sheet section. Null = an extra item (box, bag, USB…).
alter table album_lines add column if not exists section text check (section is null or char_length(btrim(section)) between 1 and 60);
