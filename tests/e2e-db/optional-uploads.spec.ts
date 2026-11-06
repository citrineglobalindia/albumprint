import { test, expect } from "@playwright/test";
import { loginAs, sql } from "./helpers";

// Uploading is optional unless the admin turns on Settings › Workflow › "Require File Uploads": a grader can update the status without files.
test("a grader submits the grading without uploading files; with uploads required it is refused", async ({ page }) => {
  const tag = Date.now().toString(36);
  const colour = "00000000-0000-0000-0000-0000000000a3";
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('NoFiles ${tag}', '7${String(Date.now()).slice(-9)}', 'pending') returning id`).split("\n")[0];
  const code = sql(`insert into orders(customer_id, type, due_date, total, code) values ('${cust}', 'design_printing', current_date + 14, 1000, 'pending') returning code`).split("\n")[0]!;
  const O = `(select id from orders where code = '${code}')`;
  sql(`select set_config('app.via_fn', '1', false); update orders set stage = 'colour_grading', assignee = '${colour}' where id = ${O}`);
  sql(`insert into tasks(order_id, kind, assignee) values (${O}, 'grading', '${colour}')`);
  const before = sql(`select coalesce((select value::text from settings where key = 'workflow'), '{}')`);
  try {
    // required → refused
    sql(`update settings set value = value || '{"wf_require_uploads": true}' where key = 'workflow'`);
    await loginAs(page, "colour");
    await page.goto("/colour-grading");
    await page.getByPlaceholder(/Search by order ID/).fill(code);
    await page.getByTestId(`job-${code}`).getByRole("button", { name: "Start" }).click();
    await expect.poll(() => sql(`select status from tasks where order_id = ${O} and kind = 'grading'`)).toBe("in_progress");
    await page.getByRole("button", { name: /Submit to Admin/ }).click();
    await expect(page.getByText("Upload at least one graded file before submitting").first()).toBeVisible();
    expect(sql(`select status from tasks where order_id = ${O} and kind = 'grading'`)).toBe("in_progress");

    // optional (the default) → submits, the order moves to admin approval
    sql(`update settings set value = value || '{"wf_require_uploads": false}' where key = 'workflow'`);
    await page.reload();
    await page.getByPlaceholder(/Search by order ID/).fill(code);
    await page.getByTestId(`job-${code}`).click();
    await expect(page.getByTestId("no-files")).toContainText("Uploading is optional");
    await page.getByRole("button", { name: /Submit to Admin/ }).click();
    await expect.poll(() => sql(`select status from tasks where order_id = ${O} and kind = 'grading'`)).toBe("submitted");
    await expect.poll(() => sql(`select stage from orders where id = ${O}`)).toBe("admin_approval");
  } finally {
    sql(`update settings set value = '${before.replaceAll("'", "''")}'::jsonb where key = 'workflow'`);
  }
});
