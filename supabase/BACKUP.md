# Backups and restore

AlbumPro keeps three kinds of copies. Use all of them.

| What | How | Where |
|---|---|---|
| **Quick copy** | Settings → Backups → *Download backup* (admin only): a zip with one JSON file per table | your computer |
| **Nightly database dump** | GitHub Actions workflow `.github/workflows/backup.yml` (01:47 IST), kept 30 days | repository → Actions → run → Artifacts |
| **Uploaded files** | Supabase Storage bucket `order-files` (copy it separately, see below) | your choice |

Supabase's own daily backups only exist on paid plans (Pro and above). On the free plan, the nightly dump below is your safety net.

## One-time setup of the nightly dump
1. Supabase dashboard → **Connect** → *Session pooler* → copy the connection string and put your database password in it
   (`postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`).
2. GitHub → this repository → **Settings → Secrets and variables → Actions → New repository secret**:
   name `SUPABASE_DB_URL`, value = that string.
3. **Actions → Nightly database backup → Run workflow** once to confirm it turns green and produces an artifact.
4. Keep the repository **private**: the dumps contain customer data.

## Restore (into a new or scratch Supabase project)
1. Create the project, then apply the schema in order: every file in `supabase/migrations/` (`0001…` onwards), e.g. with the SQL editor or the Supabase CLI (`supabase db push`).
2. Download the artifact (`public.dump`, `auth-users.sql`) from the workflow run.
3. Load the sign-in accounts first, then the data, with triggers off so history is not re-written:
   ```bash
   psql "$NEW_DB_URL" -f auth-users.sql
   pg_restore --data-only --disable-triggers --no-owner --no-privileges -d "$NEW_DB_URL" public.dump
   ```
4. Check: sign in, open a few orders, and compare the counts in `MANIFEST.json` from a *Download backup* zip taken at the same time.
5. Point the web app at the new project (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) and redeploy.

Practise this restore into a scratch project at least once a quarter. A backup that has never been restored is a guess.

## Uploaded files (Storage)
`pg_dump` does not include file bytes. Copy the bucket regularly, for example with the Supabase CLI:
```bash
supabase storage cp -r ss:///order-files ./order-files-backup --experimental
```
or with any S3-compatible tool using the project's Storage S3 credentials (Dashboard → Storage → S3 connection).

## What the *Download backup* zip is for
It is a readable, per-table copy for audits, spreadsheets and emergencies. It is not a one-click restore: use the nightly dump for restoring.
