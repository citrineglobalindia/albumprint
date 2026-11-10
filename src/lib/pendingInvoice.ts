// Design + Printing orders whose invoice is prepared later (migration 0062): the order exists, its invoice does not yet.
// orders2 registers the check; workflow (no printing before the invoice) and finance (advances before the invoice) read it.
let check: (orderCode: string) => boolean = () => false;
export const invoicePending = (orderCode: string) => check(orderCode);
export const registerInvoicePending = (f: (orderCode: string) => boolean) => { check = f; };
