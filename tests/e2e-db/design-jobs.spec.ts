import { test, expect } from "@playwright/test";
import { loginAs, sql } from "./helpers";

// Album Designing works like Colour Grading: a queue of design jobs; the designer starts one (start time, running timer),
// works from the graded photos, uploads the album pages and sends the proof — the job shows "With Client" with its end time.
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

test("designer: queue → start → upload pages → send proof → With Client, all recorded", async ({ page }) => {
  const tag = Date.now().toString(36);
  const designerId = "00000000-0000-0000-0000-0000000000a4";
  const cust = sql(`insert into customers(studio_name, mobile, email, code) values ('Design ${tag}', '9${String(Date.now()).slice(-9)}', 'd${tag}@example.com', 'pending') returning id`).split("\n")[0];
  const code = sql(`insert into orders(customer_id, type, due_date, total, code) values ('${cust}', 'design_printing', current_date + 14, 1000, 'pending') returning code`).split("\n")[0]!;
  const O = `(select id from orders where code = '${code}')`;
  sql(`insert into order_specs(order_id, album_type, album_size, orientation, pages, paper_type, cover_type, binding) values (${O}, 'Lay-flat', '12x36', 'landscape', 30, 'Matte', 'Photo', 'Lay-flat')`);
  sql(`select set_config('app.via_fn', '1', false); update orders set stage = 'designing', assignee = '${designerId}' where id = ${O}`);

  await loginAs(page, "designer");
  await page.goto("/designing");
  const row = page.getByTestId(`djob-${code}`);
  await expect(row).toContainText("New");
  await row.getByRole("button", { name: "Start" }).click();
  await expect.poll(() => sql(`select status || ':' || (started_at is not null) from tasks where order_id = ${O} and kind = 'design'`)).toBe("in_progress:true");
  const panel = page.getByTestId("design-panel");
  await expect(panel.getByTestId("job-timer").getByTestId("timer-end")).toContainText("Running");
  await expect(row).toContainText("In Progress");
  await expect(row.getByTestId("elapsed")).toHaveAttribute("data-running", "true");

  await panel.getByTestId("work-input").setInputFiles([{ name: "spread-01.png", mimeType: "image/png", buffer: PNG }, { name: "spread-02.png", mimeType: "image/png", buffer: PNG }]);
  await expect.poll(() => sql(`select count(*) from order_files where order_id = ${O} and category = 'design_draft'`)).toBe("2");
  await panel.getByPlaceholder(/Notes for the team/).fill("Full-size PSDs on the studio drive");
  await panel.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => sql(`select internal_note from tasks where order_id = ${O} and kind = 'design'`)).toBe("Full-size PSDs on the studio drive");

  // send the proof from the editor
  await panel.getByRole("link", { name: /Open editor & send proof/ }).click();
  await expect(page).toHaveURL(new RegExp(`/designing/${code}$`));
  await page.getByRole("button", { name: /Send for Client Review/ }).click();
  await page.getByRole("button", { name: "Send proof" }).click();
  await expect.poll(() => sql(`select stage from orders where id = ${O}`)).toBe("client_review");
  await expect.poll(() => sql(`select status || ':' || rounds || ':' || (submitted_at is not null) from tasks where order_id = ${O} and kind = 'design'`)).toBe("submitted:1:true");

  await page.goto("/designing");
  await page.getByRole("tab", { name: /With Client/ }).click();
  await expect(page.getByTestId(`djob-${code}`)).toContainText("With Client");
  await page.getByTestId(`djob-${code}`).click();
  await expect(page.getByTestId("design-panel").getByTestId("job-timer").getByTestId("timer-end")).toContainText("Today");
  await expect(page.getByTestId("design-history")).toContainText("Proof sent to the client (round 1)");
  await expect(page.getByTestId("design-history")).toContainText("Design started");
});
