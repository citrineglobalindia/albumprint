import { test, expect } from "@playwright/test";
import { loginAs, sql } from "./helpers";

const MODULES = ["orders", "customers", "grading", "designing", "proofs", "printing", "qc", "delivery", "finance", "costing", "files", "attendance", "access", "messaging", "system"];

// The Control Center reads the real database. "Today" must be the real date (it used to be a fixed demo date), so an order promised yesterday is overdue.
test("control center (database): overdue is judged against today's real date; every module reports; queued messages are flagged", async ({ page }) => {
  const tag = String(Date.now());
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('Control ${tag}', '9${tag.slice(-9)}', 'pending') returning id`).split("\n")[0];
  sql(`insert into orders(customer_id, type, order_date, due_date, total, code) values ('${cust}', 'design_printing', current_date - 6, current_date - 2, 5000, 'pending')`);
  sql(`insert into comm_log(customer_id, channel, direction, recipient, summary, status) values ('${cust}', 'whatsapp', 'outbound', '9${tag.slice(-9)}', 'Control Center test ${tag}', 'queued')`);

  await loginAs(page, "admin");
  await page.goto("/control");
  await expect(page.getByTestId("health-score")).toHaveText(/^\d{1,3}$/);
  await expect(page.getByTestId("kpi-od")).not.toHaveText("0");                            // the overdue order is counted
  await expect(page.getByTestId("alerts").getByText(/past the promised date/)).toBeVisible();

  await page.getByRole("tab", { name: /^Modules/ }).click();
  for (const k of MODULES) await expect(page.getByTestId(`module-${k}`)).toBeVisible();
  await expect(page.getByTestId("module-orders")).toContainText("past the promised date");
  await expect(page.getByTestId("module-messaging")).toContainText("queued but never sent");
  await expect(page.getByTestId("module-attendance")).toContainText("In now");
  await expect(page.getByTestId("module-system")).toContainText("Database");

  // refresh reloads from the database
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  await page.getByRole("tab", { name: "Workload & activity" }).click();
  await expect(page.getByTestId("workload")).toBeVisible();
  await expect(page.getByTestId("activity")).toBeVisible();
});
