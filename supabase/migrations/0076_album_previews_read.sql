-- Album preview pages: staff may read the stored page objects. Storage needs a read rule to delete objects (the delete
-- returns the removed rows) and to overwrite them; without it, removing an old version's pages was refused. The pages
-- themselves are public through the bucket's public URLs (unguessable folder), so this only adds what staff already see.
drop policy if exists album_previews_read on storage.objects;
create policy album_previews_read on storage.objects for select to authenticated
  using (bucket_id = 'album-previews' and has_perm('order', 'view'));
