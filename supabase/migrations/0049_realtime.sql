-- Live updates: the app subscribes to changes on these tables (Supabase Realtime, postgres_changes) and reloads the affected data,
-- so a job assigned, a file uploaded or a stage moved shows on everyone's screen without a page reload.
-- Realtime applies each table's row-level security, so people only hear about rows they could read anyway.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;                                  -- plain Postgres (local tests): harmless, nothing listens
  end if;
  foreach t in array array['orders','customers','order_albums','order_items','order_specs','order_pricing',
    'tasks','production_events','print_jobs','print_stage_log','print_exceptions','print_vendor_jobs','qc_inspections','rework_tasks','deliveries',
    'order_files','proofs','proof_comments','design_corrections','design_docs','payments','invoices','notifications','settings'] loop
    if to_regclass('public.' || t) is not null and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
