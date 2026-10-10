# AlbumPro database (Postgres / Supabase)

Business rules live in the database so the UI and API cannot bypass them (SRS ALB-FR-0493).

| File | What it holds |
|---|---|
| `migrations/0001_schema.sql` | Tables and enums: customers, orders (+ the SRS §23 status domains), print specs, files, workflow tasks, corrections, client proofs, print jobs, QC, deliveries, invoices, payments, masters, comm log, audit log |
| `migrations/0002_rules.sql` | Server-generated IDs (IDP/IDC/INV/RCP), the `advance_order()` workflow function, transition table (§5/§22), gates (client approval before print, QC before delivery, print-ready file for Printing Only, payment hold), file versioning and locking, immutable payments, invoice totals, append-only audit |
| `migrations/0003_security.sql` | SRS §21 role × module matrix, row-level security, masked customer view (`customers_safe`), protection of workflow columns |
| `tests/` | 100+ checks across all seven roles. `PGHOST=… PGPORT=… PGUSER=postgres tests/run.sh` against any scratch Postgres |

## Rules enforced
- Orders change stage **only** through `advance_order(order, to_stage, reason, override)`; direct edits of stage/status/paid are rejected.
- Wrong role, skipped stage, missing reason, closed/held order → error. Admin `override` needs a reason and is audited.
- Final client approval required before release to printing; QC pass required before Ready for Delivery; Printing Only needs a print-ready file; delivery blocked while payment is outstanding (unless the setting allows).
- Payments are append-only; refunds cannot exceed what was paid; order `paid`/`pay_status` recompute automatically.
- Locked final-print files are immutable; re-uploads create new versions.
- Closed orders are read-only; reopen needs admin + reason. Cancelling preserves all history.
- Every change on key tables writes `audit_log` (actor, role, old/new, reason). The log cannot be edited or deleted.

## Deploying
Not deployed anywhere yet. Create a **new, dedicated** Supabase project for AlbumPro, then apply `migrations/*.sql` in order (SQL editor, `supabase db push`, or the Supabase MCP `apply_migration`).
Then create users in Supabase Auth and insert matching `profiles` rows (role + department).
