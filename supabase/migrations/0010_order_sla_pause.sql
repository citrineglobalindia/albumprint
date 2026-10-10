-- SLA pause/resume on an order (SRS ALB-FR-0006: pause reasons must be traceable). Audited by the existing orders trigger.
alter table orders add column if not exists sla_paused_at timestamptz;
alter table orders add column if not exists sla_pause_reason text;
