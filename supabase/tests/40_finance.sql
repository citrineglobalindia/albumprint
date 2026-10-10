\set ON_ERROR_STOP on
\set QUIET on
-- Finance: receipts, refund cap, credit notes, invoices, discount approval, role gates.
reset role;
select t.as('reception');
select t.ok($$insert into customers(studio_name, mobile) values ('Fin Studio','9000000040')$$, 'fin: customer');
select t.ok($$insert into orders(customer_id, type, due_date, total) select id, 'design_printing', current_date + 14, 10000 from customers where studio_name='Fin Studio'$$, 'fin: order total 10000');
select t.ok($$insert into payments(receipt_no, order_id, amount, mode, reference) select 'x', id, 4000, 'upi', 'UTR1' from orders where total = 10000 and customer_id=(select id from customers where studio_name='Fin Studio')$$, 'reception records advance');
select t.eq($$select (receipt_no ~ '^RCP[0-9]{4}[0-9]{3,}$')::text from payments where reference='UTR1'$$, 'true', 'receipt number server-generated');
select t.eq($$select (recorded_by = auth.uid())::text from payments where reference='UTR1'$$, 'true', 'recorded_by stamped');
select t.eq($$select paid::text || '/' || pay_status::text from orders where total = 10000 and customer_id=(select id from customers where studio_name='Fin Studio')$$, '4000.00/partially_paid', 'order paid recomputed');
select t.err($$insert into payments(receipt_no, order_id, amount, mode, reference) select 'x', id, 7000, 'upi', 'UTR2' from orders where total = 10000 and customer_id=(select id from customers where studio_name='Fin Studio')$$, 'reception cannot exceed balance', 'exceeds the balance');
select t.ok($$insert into payments(receipt_no, order_id, amount, mode, reference) select 'x', id, 6000, 'cash', null from orders where total = 10000 and customer_id=(select id from customers where studio_name='Fin Studio')$$, 'reception may pay exactly the balance');
select t.eq($$select pay_status::text from orders where total = 10000 and customer_id=(select id from customers where studio_name='Fin Studio')$$, 'paid', 'order paid');
select t.err($$select issue_refund((select id from orders where total=10000 and customer_id=(select id from customers where studio_name='Fin Studio')), 100, 'cash', 'x')$$, 'reception cannot refund', 'only Accounts and Admin');
select t.err($$insert into payments(receipt_no, order_id, kind, amount, mode) select 'x', id, 'refund', 100, 'cash' from orders where total = 10000 and customer_id=(select id from customers where studio_name='Fin Studio')$$, 'reception cannot insert a refund directly', 'row-level security');
select t.err($$select create_invoice((select id from orders where total=10000 and customer_id=(select id from customers where studio_name='Fin Studio')), current_date+10, 0, 18, false, null, '[{"desc":"a","qty":1,"price":100}]')$$, 'reception cannot create invoices', 'only Accounts and Admin');
select t.as('colour');
select t.eq($$select count(*)::text from payments$$, '0', 'colour sees no payments');
select t.eq($$select count(*)::text from invoices$$, '0', 'colour sees no invoices');
select t.err($$insert into payments(receipt_no, order_id, amount, mode) select 'x', id, 1, 'cash' from orders limit 1$$, 'colour cannot record payments', 'row-level security');

select t.as('accounts');
select t.err($$select issue_refund((select id from orders where total=10000 and customer_id=(select id from customers where studio_name='Fin Studio')), 10001, 'upi', 'too much')$$, 'refund over the amount paid refused', 'exceeds amount paid');
select t.err($$select issue_refund((select id from orders where total=10000 and customer_id=(select id from customers where studio_name='Fin Studio')), 100, 'upi', '  ')$$, 'refund needs a reason', 'reason is required');
select t.ok($$select issue_refund((select id from orders where total=10000 and customer_id=(select id from customers where studio_name='Fin Studio')), 2500, 'upi', 'album size changed')$$, 'accounts issues a refund');
select t.eq($$select paid::text || '/' || pay_status::text from orders where total = 10000 and customer_id=(select id from customers where studio_name='Fin Studio')$$, '7500.00/partially_paid', 'refund reduces paid');
select t.eq($$select (number ~ '^CN-[0-9]{4}-[0-9]{4}$')::text || '/' || total::text || '/' || status from invoices where kind='credit_note' and order_id=(select id from orders where total=10000 and customer_id=(select id from customers where studio_name='Fin Studio'))$$, 'true/2500.00/sent', 'credit note numbered and valued');
select t.eq($$select (credit_note_id is not null)::text from payments where kind='refund' and notes='album size changed'$$, 'true', 'refund payment links its credit note');
select t.ok($$update payments set amount = 1$$, 'payment update attempt is a no-op');
select t.eq($$select count(*)::text from payments where amount = 1$$, '0', 'payments stay immutable');
-- invoices
select t.ok($$select create_invoice((select id from orders where total=10000 and customer_id=(select id from customers where studio_name='Fin Studio')), current_date+10, 15, 18, false, 'n', '[{"desc":"Album","qty":1,"price":8000},{"desc":"Box","qty":2,"price":500}]')$$, 'accounts creates invoice with lines (15% discount)');
select t.eq($$select (number ~ '^INV-[0-9]{4}-[0-9]{4}$')::text || '/' || status || '/' || subtotal::text || '/' || total::text from invoices where kind='invoice' and order_id=(select id from orders where total=10000 and customer_id=(select id from customers where studio_name='Fin Studio'))$$, 'true/draft/9000.00/9027.00', 'draft numbered; totals computed by trigger');
select t.err($$select create_invoice((select id from orders where total=10000 limit 1), current_date+10, 0, 18, false, null, '[]')$$, 'invoice needs lines', 'at least one line');
select t.err($$update invoices set status='sent' where kind='invoice' and discount_pct=15$$, 'discount above threshold cannot be sent', 'needs admin approval');
select t.err($$select approve_discount((select id from invoices where kind='invoice' and discount_pct=15))$$, 'accounts cannot approve discounts', 'only an admin');
select t.err($$update invoices set discount_approved_by = auth.uid() where kind='invoice' and discount_pct=15$$, 'accounts cannot self-approve via update', 'only an admin');
select t.as('admin');
select t.ok($$select approve_discount((select id from invoices where kind='invoice' and discount_pct=15))$$, 'admin approves discount');
select t.as('accounts');
select t.ok($$update invoices set status='sent' where kind='invoice' and discount_pct=15$$, 'approved invoice can be sent');
select t.eq($$select (sent_at is not null)::text from invoices where kind='invoice' and discount_pct=15$$, 'true', 'sent_at stamped');
select t.err($$update invoices set status='draft' where kind='invoice' and discount_pct=15$$, 'sent invoice cannot return to draft', 'cannot go back');
select t.err($$update invoices set discount_pct=50 where kind='invoice' and discount_pct=15$$, 'sent invoice terms are frozen', 'only draft');
select t.err($$insert into invoice_lines(invoice_id, description, qty, rate) select id, 'late', 1, 1 from invoices where kind='invoice' and discount_pct=15$$, 'sent invoice lines are frozen', 'draft');
select t.ok($$update invoices set status='overdue' where kind='invoice' and discount_pct=15$$, 'sent invoice can be marked overdue');
select t.as('reception');
select t.eq($$select count(*)::text from invoices where kind='invoice' and discount_pct=15$$, '1', 'reception can view invoices');
select t.ok($$update invoices set notes='hacked'$$, 'reception invoice edit is a no-op');
select t.as('accounts');
select t.eq($$select count(*)::text from invoices where notes='hacked'$$, '0', 'reception cannot edit invoices');
reset role;
\echo FINANCE TESTS PASSED
