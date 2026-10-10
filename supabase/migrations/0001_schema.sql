-- AlbumPro — core schema (SRS v1.0). Targets Supabase/Postgres 15+.
create extension if not exists pgcrypto;

-- ───────── enums ─────────
create type app_role as enum ('admin','reception','colour','designer','printing','qc','accounts');
create type order_type as enum ('design_printing','printing_only');
create type stage_key as enum (
  'new_order','files_received','colour_grading','admin_approval','designing','design_review','client_review',
  'final_approval','printing','qc','ready_for_delivery','delivered','closed','cancelled');
create type priority_level as enum ('low','normal','high','urgent','vip');
-- §23 status domains
create type main_status as enum ('new','active_production','awaiting_client','printing','qc','ready','delivered','closed','cancelled');
create type pay_status as enum ('unpaid','partially_paid','paid','overpaid','refunded','credit');
create type delivery_status as enum ('not_ready','ready','dispatched','delivered','failed','returned');
create type closure_status as enum ('open','operationally_complete','financially_complete','closed');
create type work_status as enum ('not_required','pending','in_progress','submitted','revision','approved');
create type print_stage as enum ('waiting','file_prep','printing','finishing','assembly','packaging','completed','sent_to_qc');
create type qc_decision as enum ('pending','in_progress','failed','rework','recheck','passed');
create type file_category as enum ('source_photos','graded','design_draft','final_print','cover','qc_evidence','invoice','other');
create type file_state as enum ('draft','submitted','approved','rejected','locked');
create type correction_source as enum ('admin','client');
create type delivery_mode as enum ('pickup','company_delivery','courier','third_party');
create type pay_mode as enum ('upi','cash','bank_transfer','cheque','card','online');
create type comm_channel as enum ('whatsapp','email','sms','call','internal_note');

-- ───────── people ─────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 150),
  email text unique,
  mobile text,
  role app_role not null,
  department text,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table counters (kind text primary key, next_value bigint not null default 1);

-- ───────── customers & orders ─────────
create table customers (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                                   -- IDC000001
  studio_name text not null check (char_length(studio_name) between 2 and 150),
  contact_person text,
  mobile text not null,
  whatsapp text,
  email text,
  address text, city text, state text, pin text,
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  segment text not null default 'regular' check (segment in ('regular','vip','new')),
  active boolean not null default true,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index on customers (mobile);

create table orders (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                                   -- IDP00073
  customer_id uuid not null references customers(id),
  type order_type not null,
  stage stage_key not null default 'new_order',
  priority priority_level not null default 'normal',
  main_status main_status not null default 'new',
  grading_status work_status not null default 'pending',
  design_status work_status not null default 'pending',
  print_status print_stage,
  qc_status qc_decision not null default 'pending',
  delivery_status delivery_status not null default 'not_ready',
  pay_status pay_status not null default 'unpaid',
  closure_status closure_status not null default 'open',
  event_name text, event_type text, bride text, groom text, event_date date,
  order_date date not null default current_date,
  due_date date not null,
  assignee uuid references profiles(id),
  total numeric(12,2) not null default 0 check (total >= 0),
  paid numeric(12,2) not null default 0,
  on_hold boolean not null default false,
  hold_reason text,
  cancel_reason text,
  special_instructions text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date >= order_date)
);
create index on orders (stage); create index on orders (customer_id); create index on orders (due_date);

-- §6.1 printing requirement capture
create table order_specs (
  order_id uuid primary key references orders(id) on delete cascade,
  album_type text not null, album_size text not null,
  orientation text not null check (orientation in ('landscape','portrait','square')),
  pages int not null check (pages > 0), copies int not null default 1 check (copies >= 1),
  paper_type text not null, paper_gsm int, printing_type text,
  cover_type text not null, cover_material text, cover_colour text,
  lamination text, binding text not null, sheet_thickness text,
  box_required boolean not null default false,
  box_type text,
  uv_printing boolean not null default false, foiling boolean not null default false,
  embossing boolean not null default false, acrylic_cover boolean not null default false,
  name_printing text, special_instructions text,
  check (not box_required or box_type is not null)           -- ALB-FR-0096
);

-- ───────── files (§7) ─────────
create table order_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  category file_category not null,
  file_name text not null check (file_name ~ '^[^/\\\x00]+$'),
  ext text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  version int not null default 1,
  storage_path text not null,
  checksum text,
  state file_state not null default 'draft',
  archived boolean not null default false,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now(),
  unique (order_id, category, file_name, version)
);

-- ───────── workflow ─────────
create table stage_transitions (
  order_type order_type not null,
  from_stage stage_key not null,
  to_stage stage_key not null,
  allowed_roles app_role[] not null,
  needs_reason boolean not null default false,
  primary key (order_type, from_stage, to_stage)
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  kind text not null check (kind in ('grading','design','print','qc','delivery')),
  assignee uuid references profiles(id),
  status work_status not null default 'pending',
  due_at timestamptz,
  started_at timestamptz, submitted_at timestamptz, completed_at timestamptz,
  sla_paused_at timestamptz, sla_pause_reason text,
  note text,
  created_at timestamptz not null default now()
);

create table corrections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  source correction_source not null,
  page_no int, note text not null,
  assigned_to uuid references profiles(id),
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_by uuid references profiles(id), created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table proofs (            -- §11 client proofing; only the hash of the secure token is stored
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  version int not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  status text not null default 'sent' check (status in ('sent','viewed','approved','corrections_requested','expired','revoked')),
  responded_at timestamptz, client_note text,
  sent_by uuid references profiles(id), sent_at timestamptz not null default now()
);

create table print_jobs (
  order_id uuid primary key references orders(id),
  stage print_stage not null default 'waiting',
  paper_type text, sheets int, copies int,
  operator uuid references profiles(id),
  outsourced_to text,
  due_at timestamptz,
  updated_at timestamptz not null default now()
);

create table qc_inspections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  round int not null default 1,
  inspector uuid references profiles(id),
  decision qc_decision not null default 'pending',
  checklist jsonb not null default '{}',                      -- {item: 'pass'|'fail'|'na'}
  defect_codes text[] not null default '{}',
  notes text,
  evidence_paths text[] not null default '{}',
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (decision not in ('failed','rework') or cardinality(defect_codes) > 0)   -- defect reason required
);

create table deliveries (
  order_id uuid primary key references orders(id),
  mode delivery_mode not null,
  courier text, tracking_no text,
  address text, city text, pin text,
  dispatched_at timestamptz, delivered_at timestamptz,
  proof_path text, received_by text,
  status delivery_status not null default 'ready'
);

-- ───────── money ─────────
create table invoices (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,                                -- INV-2026-0001
  order_id uuid not null references orders(id),
  customer_id uuid not null references customers(id),
  issue_date date not null default current_date, due_date date not null,
  status text not null default 'draft' check (status in ('draft','sent','paid','partially_paid','overdue','void')),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  discount_approved_by uuid references profiles(id),
  gst_rate numeric(5,2) not null default 18,
  subtotal numeric(12,2) not null default 0, tax numeric(12,2) not null default 0, total numeric(12,2) not null default 0,
  notes text, created_by uuid references profiles(id), created_at timestamptz not null default now()
);
create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null, qty numeric(10,2) not null check (qty > 0), rate numeric(12,2) not null check (rate >= 0)
);
create table payments (
  id uuid primary key default gen_random_uuid(),
  receipt_no text unique not null,                            -- RCP2026306
  order_id uuid not null references orders(id),
  invoice_id uuid references invoices(id),
  kind text not null default 'payment' check (kind in ('payment','refund')),
  amount numeric(12,2) not null check (amount > 0),
  mode pay_mode not null,
  reference text, paid_on date not null default current_date, notes text,
  recorded_by uuid references profiles(id), created_at timestamptz not null default now()
);

-- ───────── masters, config, comms, audit ─────────
create table masters (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                                          -- album_type, paper, lamination, qc_defect, …
  name text not null, value jsonb not null default '{}', sort int not null default 0, active boolean not null default true,
  unique (kind, name)
);
create table products (
  id uuid primary key default gen_random_uuid(), sku text unique not null, name text not null, category text,
  size text, sheets int, price numeric(12,2) not null check (price >= 0), active boolean not null default true, image_path text
);
create table settings (key text primary key, value jsonb not null, updated_by uuid references profiles(id), updated_at timestamptz not null default now());
create table sla_rules (stage stage_key primary key, hours int not null check (hours > 0), escalate_after_hours int);
create table role_permissions (role app_role not null, module text not null, level text not null check (level in ('none','view','limited','update','work','create_edit','approve','full')), primary key (role, module));

create table comm_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id), customer_id uuid references customers(id),
  channel comm_channel not null, direction text not null check (direction in ('inbound','outbound')),
  template text, recipient text, summary text,
  status text not null default 'queued' check (status in ('queued','sent','delivered','read','failed')),
  sent_at timestamptz not null default now(), created_by uuid references profiles(id)
);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid, actor_role app_role,
  entity text not null, entity_id text, action text not null,
  old_data jsonb, new_data jsonb, reason text
);
create index on audit_log (entity, entity_id);
