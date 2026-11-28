import { test, expect } from "@playwright/test";
import { seedRole, buildOrder } from "./helpers";

// Couple name: a column after Customer in the orders lists and on the order page; Edit order changes couple, event, due date, priority.
test("orders show the couple name; Edit order updates couple, event, due date and priority", async ({ page }) => {
  test.setTimeout(90_000);
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Wedding album", sheets: 10 }], finalize: true }))!;
  await page.goto(`/orders/${code}`);
  await page.getByRole("button", { name: "Edit order" }).click();
  const f = page.getByTestId("edit-order");
  await f.getByLabel("Couple name").fill("Asha & Ravi");
  await f.getByLabel("Event", { exact: true }).fill("Reception");
  await f.getByLabel("Due date", { exact: true }).fill("2026-12-20");
  await f.getByLabel("Priority").selectOption("High");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`${code} updated`).first()).toBeVisible();
  await expect(page.getByText(/Asha & Ravi · Reception · .* · due 20 Dec 2026/)).toBeVisible();

  for (const list of ["/orders", "/design-orders"]) {
    await page.goto(list);
    await expect(page.getByRole("columnheader", { name: /Couple/ })).toBeVisible();
    await page.getByPlaceholder(/^Search by Order ID/).fill(code);
    await expect(page.getByTestId(`couple-${code}`)).toHaveText("Asha & Ravi");
  }
  await page.reload();
  await page.getByPlaceholder(/^Search by Order ID/).fill(code);
  await expect(page.getByTestId(`couple-${code}`)).toHaveText("Asha & Ravi");      // kept

  // reception can edit too; other roles can't
  await page.evaluate(() => localStorage.setItem("albumpro.role", "accounts"));
  await page.goto(`/orders/${code}`);
  await expect(page.getByRole("button", { name: "Edit order" })).toHaveCount(0);
});

test("the orders list Edit edits the whole order: details, each album, and (admin) albums/items/price through the order builder", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Wedding album", sheets: 10, size: "12x36" }, { name: "Reception album", sheets: 8, size: "12x30" }], finalize: true }))!;
  await page.goto("/design-orders");
  await page.getByPlaceholder(/^Search by Order ID/).fill(code);
  const row = page.getByRole("row").filter({ hasText: code });
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const f = page.getByTestId("edit-order");
  await f.getByLabel("Couple name").fill("Meera & Arjun");
  await f.getByLabel("Priority").selectOption("Urgent");
  const a2 = f.getByTestId("edit-album-2");
  await expect(a2).toContainText("8 sheets");
  await a2.getByLabel("Album 2 name").fill("Sangeet album");
  await a2.getByLabel("Album 2 size").selectOption("__custom");
  await a2.getByLabel("Custom album 2 size").fill("15x24");
  await a2.getByRole("button", { name: "Save" }).click();
  await a2.getByLabel("Album 2 orientation").selectOption("Portrait");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`${code} updated`).first()).toBeVisible();
  await expect(page.getByTestId(`couple-${code}`)).toHaveText("Meera & Arjun");
  await expect(row).toContainText("12x36, 15x24");
  await expect(row).toContainText("Urgent");

  // reopen it: the albums are kept
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(f.getByTestId("edit-album-2").getByLabel("Album 2 name")).toHaveValue("Sangeet album");
  await expect(f.getByTestId("edit-album-2").getByLabel("Album 2 orientation")).toHaveValue("Portrait");
  // sheets, copies, items and price: the authorized edit in the order builder
  await f.getByRole("button", { name: "Edit albums, items & price" }).click();
  await f.getByLabel("Reason for editing").fill("customer added a copy");
  await f.getByRole("button", { name: "Open in order builder" }).click();
  await expect(page).toHaveURL(/\/orders\/new\?draft=/);
  await expect(page.getByRole("heading", { name: `Edit order ${code}` })).toBeVisible();
  await page.getByRole("button", { name: "Albums & items" }).click();
  await page.getByRole("tab", { name: /^Sangeet album/ }).click();                                   // the edits made in the panel come along
  await expect(page.getByTestId("album-2").getByLabel("Album name")).toHaveValue("Sangeet album");
  await expect(page.getByTestId("album-2").getByLabel("Size")).toHaveValue("15x24");
});
