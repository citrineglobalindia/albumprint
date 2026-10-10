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

## Deployed
Applied to the dedicated AlbumPro Supabase project (ref `wwwbzqsckoofuryqjrxe`, "My Project", org Stepstones Solutions) as migrations 0001–0006.
Smoke-tested live (rolled back): order codes are generated, reception cannot approve grading, direct stage edits are blocked, the colour grader sees masked phone numbers and zero raw customer rows, `anon` is locked out.
The Supabase security advisor's remaining notes are intentional: `counters` has RLS and no policy (only trigger functions touch it) and `advance_order`, `lock_final_print_file`, `has_perm`, `current_app_role` are callable RPCs.

`DROP VIEW customers_safe` hangs on the hosted project, so migration 0006 retires that view (security_invoker, no grants) instead of dropping it. `list_customers()` is the masked directory the app should call.

Before first use: create users in Supabase Auth and insert matching `profiles` rows (role + department). Nothing is seeded except permissions, transitions, SLA rules and settings.
