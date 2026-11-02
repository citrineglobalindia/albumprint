-- The event-notification trigger functions (0035) are only ever run by their triggers: nobody needs to call them directly (security advisor).
revoke execute on function orders_notify(), payments_notify(), qc_notify(), invoice_notify(), delivery_notify() from public, anon, authenticated;
