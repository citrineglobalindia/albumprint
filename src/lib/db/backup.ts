import { sb } from "./core";

/** Every business table an admin can read, in dependency order. File bytes live in Storage and are not part of this export. */
export const BACKUP_TABLES = [
  "profiles", "role_permissions", "settings", "masters", "products", "catalog_items", "catalog_costs", "sla_rules", "notification_templates", "report_schedules",
  "customers", "orders", "order_specs", "order_albums", "order_items", "order_costing", "album_lines", "album_line_costs",
  "order_files", "tasks", "corrections", "proofs", "proof_comments", "print_jobs", "print_stage_log", "print_exceptions", "print_vendor_jobs", "qc_inspections", "rework_tasks", "deliveries", "production_events",
  "invoices", "invoice_lines", "payments", "comm_log", "staff_invites", "attendance_settings", "attendance_events", "attendance_leaves", "audit_log",
] as const;
const PAGE = 1000;
// proofs hides its link-token hash from staff, so the readable columns are listed explicitly (the nightly database dump has everything)
const COLUMNS: Record<string, string> = { proofs: "id,order_id,version,expires_at,status,responded_at,client_note,sent_by,sent_at,viewed_at,approved_by,sent_via" };

/** Download one JSON file per table, zipped. Admin only (row-level security returns nothing to other roles). */
export async function downloadBackup(onProgress?: (done: number, total: number, table: string) => void): Promise<{ tables: number; rows: number; skipped: string[] }> {
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  const counts: Record<string, number> = {}, skipped: string[] = [];
  let rows = 0;
  for (const [i, table] of BACKUP_TABLES.entries()) {
    onProgress?.(i, BACKUP_TABLES.length, table);
    const all: unknown[] = [];
    let failed = false;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb().from(table).select(COLUMNS[table] ?? "*").range(from, from + PAGE - 1);
      if (error) { failed = true; skipped.push(`${table}: ${error.message}`); break; }
      all.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    if (failed) continue;
    files[`${table}.json`] = strToU8(JSON.stringify(all, null, 1));
    counts[table] = all.length; rows += all.length;
  }
  files["MANIFEST.json"] = strToU8(JSON.stringify({ app: "albumpro", exportedAt: new Date().toISOString(), tables: counts, skipped, note: "Row data only. Uploaded files are stored in Supabase Storage (bucket order-files) and are not included. See supabase/BACKUP.md to restore." }, null, 2));
  const blob = new Blob([zipSync(files) as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = `albumpro-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.zip`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  try { localStorage.setItem("albumpro.lastBackup", new Date().toISOString()); } catch { /* ignore */ }
  return { tables: Object.keys(counts).length, rows, skipped };
}
