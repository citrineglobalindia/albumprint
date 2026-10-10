-- AlbumPro — live-sensible defaults for the shared configuration. Every statement is INSERT … ON CONFLICT (existing values win), so re-running is safe.

-- ───────── pricing rules (read by every role through settings 'pricing'; the DB discount rule keeps using discount_approval_pct) ─────────
insert into settings(key, value) values ('pricing', jsonb_build_object(
  'albumTypes', '{"Premium Album":8500,"Classic Album":6200,"Magnetic Album":10500,"Acrylic Album":12000,"Photobook":3800,"Layflat Album":9500,"Coffee Table":14000}'::jsonb,
  'paper',      '{"Silk":55,"Metallic":95,"Matte":60,"Glossy":58,"Velvet":90,"Fine Art":110}'::jsonb,
  'covers',     '{"Leatherette":0,"Acrylic":1500,"Photo Wrap":500,"Fabric":800,"Custom":1200}'::jsonb,
  'lamination', '{"None":0,"Matte":300,"Gloss":300,"Texture":450}'::jsonb,
  'boxes',      '{"None":0,"Standard":400,"Premium":900,"Wooden":1800,"Acrylic":1500,"Custom":1500}'::jsonb,
  'finishes',   '{"UV Printing":600,"Foiling":800,"Embossing":700}'::jsonb,
  'designCharge', 4000, 'gradingPerImage', 4, 'gstPct', 18, 'discountApprovalPct', 10,
  'discount_approval_pct', 10, 'gst_rate', 18))
on conflict (key) do update set value = excluded.value || settings.value;

-- ───────── workflow: business hours + SLA warning threshold (engine keys stay as they were) ─────────
insert into settings(key, value) values ('workflow', jsonb_build_object(
  'allow_delivery_without_full_payment', false, 'auto_assign_next_dept', true,
  'bh_start', '10', 'bh_end', '19', 'bh_days', '1,2,3,4,5,6', 'bh_holidays', '', 'sla_warn_pct', '75'))
on conflict (key) do update set value = excluded.value || settings.value;

-- SLA hours per stage (0002 seeded these; this only fills any stage that is missing)
insert into sla_rules(stage, hours, escalate_after_hours) values
 ('files_received',4,8),('colour_grading',24,36),('admin_approval',8,16),('designing',72,96),('design_review',8,16),
 ('client_review',72,120),('final_approval',8,16),('printing',72,96),('qc',8,16),('ready_for_delivery',24,48)
on conflict (stage) do nothing;

-- ───────── masters (kind = list; ref = stable id used by the Masters screen) ─────────
insert into masters(kind, ref, name, value, sort)
select v.kind, 'M' || t.o, t.n, jsonb_build_object('detail', v.detail) || case when v.priced then jsonb_build_object('price', 500 + (t.o - 1) * 250) else '{}'::jsonb end, t.o::int
from (values
  ('printing_option', 'Paper type',          true,  array['Silk','Metallic','Matte','Glossy','Velvet','Fine Art']),
  ('material',        'Cover material',      true,  array['Leatherette','Acrylic','Photo Wrap','Fabric','Wood']),
  ('event_type',      'Order category',      false, array['Wedding','Reception','Engagement','Baby','Corporate','Pre Wedding']),
  ('cover_type',      'Cover',               true,  array['Acrylic','Leatherette','Photo Wrap','Fabric','Custom']),
  ('box_type',        'Box',                 true,  array['Standard','Premium','Wooden','Acrylic','Custom']),
  ('design_style',    'Design style',        false, array['Classic','Candid / Magazine','Minimal','Cinematic'])
) v(kind, detail, priced, names), unnest(v.names) with ordinality as t(n, o)
on conflict do nothing;

-- "Other masters": ref = '<List label><index>' exactly as the Masters screen numbers them
insert into masters(kind, ref, name, value, sort)
select v.kind, v.label || (t.o - 1), t.n, jsonb_build_object('detail', v.label), t.o::int
from (values
  ('paper_gsm',     'Paper GSM',      array['200','250','300','350']),
  ('lamination',    'Lamination',     array['Matte','Gloss','Texture','None']),
  ('binding',       'Binding Type',   array['Lay-flat','Flush mount','Standard','Custom']),
  ('qc_defect',     'QC Defects',     array['Colour shift','Misalignment','Scratches','Missing page','Binding defect']),   -- QC defect taxonomy
  ('delivery_mode', 'Delivery Modes', array['Pickup','Courier','Hand delivery','Studio dispatch']),
  ('priority',      'Priorities',     array['Low','Normal','High','Urgent','VIP'])
) v(kind, label, names), unnest(v.names) with ordinality as t(n, o)
on conflict do nothing;

-- ───────── album products ─────────
insert into products(sku, name, category, size, sheets, price, active) values
 ('PRD001','Premium Album','Premium Albums','12x36',60,8500,true),   ('PRD002','Classic Album','Standard Albums','12x30',50,6200,true),
 ('PRD003','Magnetic Album','Magnetic Albums','14x10',50,10500,true), ('PRD004','Acrylic Album','Acrylic Albums','12x18',45,12000,true),
 ('PRD005','Photobook','Photobooks','10x10',30,3800,true),            ('PRD006','Layflat Album','Layflat Albums','12x36',40,9500,true),
 ('PRD007','Flush Mount Album','Premium Albums','11x14',40,7800,false),('PRD008','Parents Album','Standard Albums','8x12',25,4200,true),
 ('PRD009','Mini Album','Photobooks','6x8',20,2500,true),             ('PRD010','Designer Album','Premium Albums','12x30',50,9800,true)
on conflict (sku) do nothing;
