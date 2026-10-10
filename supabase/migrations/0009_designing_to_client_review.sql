-- The app sends a design to the client directly from Designing (admin approval is enforced in the app via the design-review flag).
-- Add that transition so the database accepts what the UI does. TODO: model Admin Design Review as a server-side gate.
insert into stage_transitions(order_type, from_stage, to_stage, allowed_roles, needs_reason)
values ('design_printing', 'designing', 'client_review', '{admin,designer}', false)
on conflict do nothing;
