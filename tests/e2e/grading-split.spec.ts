import { test, expect, type Page } from "@playwright/test";
import { seedRole, buildOrder } from "./helpers";

// Colour grading split: the admin divides 100 photos between two graders (40 + 60), adds extra photos later for another
// person, and moves a grader's pending photos to someone new; each grader adds what they graded to their own share.
const split = (page: Page) => page.getByTestId("grading-split");
const share = (page: Page, id: string) => split(page).getByTestId(`share-${id}`);

test("admin divides photos between graders, adds extra photos, moves pending photos; graders record their own", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Wedding", sheets: 20 }], photosGiven: "100", finalize: true }))!;
  await page.goto(`/orders/${code}`);
  await expect(split(page).getByTestId("split-totals")).toContainText("100 given · 0 assigned · 0 done · 0 pending · 100 not assigned");

  // 100 = 40 to Karthik + 60 to Neha
  await split(page).getByLabel("Assign photos to").selectOption({ label: "Karthik V — Colour Grading" });
  await split(page).getByLabel("Photos to assign").fill("40");
  await split(page).getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByText("40 photos assigned to Karthik V").first()).toBeVisible();
  await split(page).getByLabel("Assign photos to").selectOption({ label: "Neha Reddy — Colour Grading" });
  await split(page).getByLabel("Photos to assign").fill("70");
  await split(page).getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByText(/Only 60 of 100 photos are left to divide/).first()).toBeVisible();
  await split(page).getByLabel("Photos to assign").fill("60");
  await split(page).getByRole("button", { name: "Assign", exact: true }).click();
  await expect(split(page).getByTestId("split-totals")).toContainText("100 given · 100 assigned · 0 done · 100 pending");

  // extra photos arrive: 20 more, given to someone new (Divya)
  await split(page).getByRole("button", { name: "Add extra photos" }).click();
  await split(page).getByLabel("Extra photos for").selectOption("U5");
  await split(page).getByLabel("Extra photos", { exact: true }).fill("20");
  await split(page).getByRole("button", { name: "Add photos" }).click();
  await expect(page.getByText(/20 extra photos added \(photos given 120\)/).first()).toBeVisible();
  await expect(split(page).getByTestId("split-totals")).toContainText("120 given · 120 assigned · 0 done · 120 pending");

  // the grader (Karthik) sees only his photos on My Jobs and adds what he graded
  await page.evaluate(() => localStorage.setItem("albumpro.role", "colour"));
  await page.goto("/my-jobs");
  const mine = page.getByTestId("my-shares");
  await expect(mine).toContainText(code);
  await expect(mine).toContainText("40 pending");
  await mine.getByLabel("Photos graded by Karthik V").fill("30");
  await mine.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText(/Karthik V: \+30 → 30\/40 · order 30\/120 graded/).first()).toBeVisible();
  await expect(mine.getByTestId("share-count")).toHaveText("30/40 done");
  await expect(mine.getByRole("button", { name: "Move pending" })).toHaveCount(0);        // admin only
  await expect(mine).not.toContainText("Neha");                                            // only his own photos

  // admin: Karthik's 10 pending photos go to a new person (Ameer)
  await page.evaluate(() => localStorage.setItem("albumpro.role", "admin"));
  await page.goto(`/orders/${code}`);
  await share(page, "U4").getByRole("button", { name: "Move pending" }).click();
  await share(page, "U4").getByLabel(/^Move pending photos from Karthik V to/).selectOption("U8");
  await share(page, "U4").getByRole("button", { name: /^Move/ }).last().click();
  await expect(page.getByText("10 pending photos moved from Karthik V to Ameer Khan").first()).toBeVisible();
  await expect(share(page, "U4").getByTestId("share-count")).toHaveText("30/30 done");
  await expect(share(page, "U8").getByTestId("share-count")).toHaveText("0/10 done");

  // the rest gets graded: the order's photos graded is the total of everyone's
  for (const [id, n] of [["U9", "60"], ["U5", "20"], ["U8", "10"]] as const) {
    await share(page, id).getByLabel(/^Photos graded by/).fill(n);
    await share(page, id).getByRole("button", { name: "Add" }).click();
  }
  await expect(split(page).getByTestId("split-totals")).toContainText("120 given · 120 assigned · 120 done · 0 pending");
});
