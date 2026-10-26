import { test, expect } from "@playwright/test";
import { loginAs, sql } from "./helpers";

// Notifications come from the database whoever makes the change; the bell polls, announces what arrives, and opens a page the receiver can use.
test("a stage change made elsewhere reaches the right person's bell (toast, list, link, read state)", async ({ page }) => {
  test.setTimeout(150_000);
  const tag = String(Date.now());
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('Bell ${tag}', '9${tag.slice(-9)}', 'pending') returning id`).split("\n")[0];
  const code = sql(`insert into orders(customer_id, type, stage, due_date, total) values ('${cust}', 'design_printing', 'qc', current_date + 10, 0) returning code`).split("\n")[0]!;

  await loginAs(page, "reception");
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Notifications/ }).first()).toBeVisible();
  sql(`update orders set stage = 'ready_for_delivery' where code = '${code}'`);                      // QC passes it (someone else, elsewhere)
  await expect(page.getByText("New notification: QC passed — ready for delivery").first()).toBeVisible({ timeout: 60_000 });   // the bell polls every 30 s

  await page.getByRole("button", { name: /^Notifications/ }).first().click();
  const panel = page.getByRole("dialog", { name: "Recent notifications" });
  const item = panel.getByRole("button", { name: new RegExp(`QC passed — ready for delivery ${code} `) });
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/orders/${code}$`));
  await expect.poll(() => sql(`select count(*) from notifications where title like 'QC passed%' and body like '%${code}%' and read_at is not null`)).toBe("1");   // read state is saved
  expect(sql(`select count(*) from notifications n join profiles p on p.id = n.user_id where n.body like '%${code}%' and p.role = 'designer'`)).toBe("0");   // and not sent to unrelated roles
});

test("reassigning and re-prioritising in the Control Center are saved, and the new assignee is notified", async ({ page }) => {
  test.setTimeout(120_000);
  const tag = String(Date.now());
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('Assign ${tag}', '9${tag.slice(-9)}', 'pending') returning id`).split("\n")[0];
  const code = sql(`insert into orders(customer_id, type, stage, due_date, total) values ('${cust}', 'design_printing', 'designing', current_date + 10, 0) returning code`).split("\n")[0]!;

  await loginAs(page, "admin");
  await page.goto("/control");
  await page.getByRole("tab", { name: "Order controls" }).click();
  await page.getByRole("button", { name: "Select an order to manage…" }).click();
  await page.getByPlaceholder("Type to search…").fill(code);
  await page.getByRole("button", { name: new RegExp(code) }).first().click();
  const ctl = page.getByTestId("order-controls");
  await ctl.getByRole("button", { name: "Reassign" }).click();
  const dlg = page.getByRole("dialog", { name: "Reassign job" });
  await dlg.getByRole("button", { name: "Select…" }).click();
  await dlg.getByPlaceholder("Type to search…").fill("Ramesh");
  await dlg.getByRole("button", { name: /Ramesh Kumar/ }).first().click();
  await dlg.getByLabel("Reason").fill("designer is free");
  await dlg.getByRole("button", { name: "Reassign" }).click();
  await expect.poll(() => sql(`select p.full_name from orders o join profiles p on p.id = o.assignee where o.code = '${code}'`)).toBe("Ramesh Kumar");   // saved, not just on screen
  expect(sql(`select link from notifications n join profiles p on p.id = n.user_id where n.title = 'Job assigned to you' and n.body like '%${code}%' and p.role = 'designer'`)).toBe(`/designing/${code}`);

  await ctl.getByRole("button", { name: "Change priority" }).click();
  const pd = page.getByRole("dialog", { name: "Change priority" });
  await pd.getByRole("button", { name: "Select…" }).click();
  await pd.getByRole("button", { name: "Urgent", exact: true }).click();
  await pd.getByRole("button", { name: "Update priority" }).click();
  await expect.poll(() => sql(`select priority::text from orders where code = '${code}'`)).toBe("urgent");
  await page.reload();
  await page.getByRole("tab", { name: "Order controls" }).click();                                   // still assigned after a reload
  await page.getByRole("button", { name: "Select an order to manage…" }).click();
  await page.getByPlaceholder("Type to search…").fill(code);
  await page.getByRole("button", { name: new RegExp(code) }).first().click();
  await expect(page.getByTestId("order-controls").getByText("Ramesh", { exact: true })).toBeVisible();
});
