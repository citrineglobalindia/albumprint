-- Local development users (one per role) and sample master data. NOT for production.
insert into auth.users(id, email, encrypted_password) values
 ('00000000-0000-0000-0000-0000000000a1','admin@albumpro.local',     crypt('AlbumPro-Local-1', gen_salt('bf'))),
 ('00000000-0000-0000-0000-0000000000a2','reception@albumpro.local', crypt('AlbumPro-Local-1', gen_salt('bf'))),
 ('00000000-0000-0000-0000-0000000000a3','colour@albumpro.local',    crypt('AlbumPro-Local-1', gen_salt('bf'))),
 ('00000000-0000-0000-0000-0000000000a4','designer@albumpro.local',  crypt('AlbumPro-Local-1', gen_salt('bf'))),
 ('00000000-0000-0000-0000-0000000000a5','printing@albumpro.local',  crypt('AlbumPro-Local-1', gen_salt('bf'))),
 ('00000000-0000-0000-0000-0000000000a6','qc@albumpro.local',        crypt('AlbumPro-Local-1', gen_salt('bf'))),
 ('00000000-0000-0000-0000-0000000000a7','accounts@albumpro.local',  crypt('AlbumPro-Local-1', gen_salt('bf')));
insert into profiles(id, full_name, email, role, department, must_change_password) values
 ('00000000-0000-0000-0000-0000000000a1','Admin','admin@albumpro.local','admin','Head Office',false),
 ('00000000-0000-0000-0000-0000000000a2','Priya N','reception@albumpro.local','reception','Reception',false),
 ('00000000-0000-0000-0000-0000000000a3','Karthik V','colour@albumpro.local','colour','Colour Grading',false),
 ('00000000-0000-0000-0000-0000000000a4','Ramesh Kumar','designer@albumpro.local','designer','Designing',false),
 ('00000000-0000-0000-0000-0000000000a5','Manjunath P','printing@albumpro.local','printing','Printing',false),
 ('00000000-0000-0000-0000-0000000000a6','Divya S','qc@albumpro.local','qc','Quality Control',false),
 ('00000000-0000-0000-0000-0000000000a7','Suresh B','accounts@albumpro.local','accounts','Accounts',false);
