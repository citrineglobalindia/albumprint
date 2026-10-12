import { test, expect } from "@playwright/test";
import { loginAs, sql } from "./helpers";

// A multi-album order created through the wizard is stored in the database: one order, album #1 in order_specs, every album in order_albums.
test("reception creates an order with two albums and the couple's name", async ({ page }) => {
  const studio = `Album Spec ${Date.now()}`;
  await loginAs(page, "reception");
  await page.goto("/orders");
  await page.getByRole("button", { name: "Create Order" }).first().click();
  const dlg = page.getByRole("dialog", { name: "New Order" });
  await dlg.getByRole("button", { name: /^Customer/ }).click();
  await page.getByPlaceholder("Type to search…").fill(studio);
  await page.getByRole("button", { name: /Add new customer/ }).last().click();
  await dlg.getByPlaceholder("Mobile number").fill(`9${String(Date.now()).slice(-9)}`);
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByLabel("Couple Name").fill("Asha & Ravi");
  await dlg.getByLabel("Work Group").selectOption("Photo Book");
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByRole("button", { name: "Add album" }).click();
  await dlg.getByLabel("Album Name").fill("Engagement Album");
  await dlg.getByLabel("Album Type").selectOption("Photobook");
  await dlg.getByLabel("Album Size").selectOption("8x12");
  for (let i = 0; i < 3; i++) await dlg.getByRole("button", { name: "Next" }).click();    // items, pricing, review
  await dlg.getByRole("button", { name: "Create Order" }).click();
  await expect(page).toHaveURL(/\/orders\/IDP\d+$/, { timeout: 20_000 });
  const code = page.url().split("/").pop()!;
  await expect(page.getByText("Print Specification · 2 albums")).toBeVisible();

  const o = sql(`select id from orders where code = '${code}'`);
  expect(sql(`select couple_name from orders where id = '${o}'`)).toBe("Asha & Ravi");
  expect(sql(`select work_group from orders where id = '${o}'`)).toBe("Photo Book");
  expect(sql(`select count(*) from order_specs where order_id = '${o}'`)).toBe("1");
  expect(sql(`select string_agg(position || ':' || title || ':' || album_size, ',' order by position) from order_albums where order_id = '${o}'`)).toBe("1:Asha & Ravi Wedding Album:12x36,2:Engagement Album:8x12");

  await page.reload();                                         // albums come back from the database after a reload
  await expect(page.getByText("Print Specification · 2 albums")).toBeVisible();
  await expect(page.getByText("Engagement Album · Photobook")).toBeVisible();
});
