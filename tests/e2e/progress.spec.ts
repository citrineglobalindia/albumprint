import { test, expect } from "@playwright/test";
import { seedRole, buildOrder, invoiceNow } from "./helpers";

// Counts and status updates: photos given at order time (optional), photos graded by the grader, sheets designed by the designer,
// each department's status + note — all shown on the order page's process list.
test("photos given → photos graded → sheets designed, with status updates, shown on the order page", async ({ page }) => {
  await seedRole(page, "admin");
  // a wrong count is refused (optional, whole number)
  await page.goto("/orders/new");
  await page.getByRole("radio", { name: /Design \+ Printing/ }).click(); await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /^Search customer/ }).click(); await page.getByRole("button", { name: /^Sharma Studio/ }).first().click(); await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Photos given").fill("12.5");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Photos given must be a whole number").first()).toBeVisible();
  const code = (await buildOrder(page, { albums: [{ name: "Counted album", sheets: 30 }], finalize: true, photosGiven: "400" }))!;
  await page.goto(`/orders/${code}`);
  await expect(page.getByTestId("step-progress-new_order")).toContainText("Photos given: 400");

  // grading: the grader's count (admin can act for any department)
  await page.getByRole("button", { name: "Move to Files Received" }).click();
  await page.getByRole("button", { name: "Move to Colour Grading" }).click();
  await page.goto("/colour-grading");
  await page.getByPlaceholder(/Search by order ID/).fill(code);
  await page.getByTestId(`job-${code}`).click();
  const g = page.getByTestId("progress-grading");
  await g.getByLabel("Photos graded").fill("120"); await g.getByLabel("grading status").selectOption("working"); await g.getByLabel("grading note").fill("rest tomorrow");
  await g.getByRole("button", { name: "Update" }).click();
  await expect(g.getByTestId("progress-grading-pct")).toHaveText("120 / 400 · 30%");
  // the jobs table shows photos graded and pending; the cards add them up
  await expect(page.getByTestId(`graded-${code}`)).toHaveText("120 / 400");
  await expect(page.getByTestId(`pending-${code}`)).toHaveText("280 pending");
  await expect(page.getByTestId("photo-kpis")).toContainText("Photos graded (all)");
  await expect(page.getByTestId("photo-kpis")).toContainText("Projects worked (all)");
  // a later sitting: add 80 more to the total; the grader notes where the graded files are
  await g.getByLabel("Add more done now").fill("80"); await g.getByRole("button", { name: "Add" }).click();
  await expect(g.getByTestId("progress-grading-pct")).toHaveText("200 / 400 · 50%");
  await expect(page.getByTestId(`pending-${code}`)).toHaveText("200 pending");
  await g.getByLabel("Graded files path / link").fill("D:\\Orders\\Graded");
  await g.getByRole("button", { name: "Update" }).click();
  await expect(g.getByLabel("Graded files path / link")).toHaveValue("D:\\Orders\\Graded");
  await page.goto(`/orders/${code}`);
  await expect(page.getByTestId("step-progress-colour_grading")).toContainText("Photos graded 200 of 400 · Working on it · “rest tomorrow”");
  await expect(page.getByTestId("step-path-colour_grading")).toContainText("D:\\Orders\\Graded");
});

test("an order with several albums keeps progress per album on the order page", async ({ page }) => {
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Engagement", sheets: 30 }, { name: "Haldi", sheets: 20 }, { name: "Mehandi", sheets: 25 }], finalize: true }))!;
  await page.goto(`/orders/${code}`);
  const t = page.getByTestId("album-progress");
  await expect(t.getByTestId(/^album-row-/)).toHaveCount(3);
  await t.getByTestId("cell-2-design").click();
  const ed = page.getByTestId("progress-design-album-2");
  await ed.getByLabel("Sheets designed").fill("20");
  await ed.getByLabel("design status").selectOption("done");
  await ed.getByRole("button", { name: "Update" }).click();
  await expect(t.getByTestId("cell-2-design")).toContainText("20 / 20");
  await expect(t.getByTestId("cell-2-design")).toContainText("Done");
  await expect(t.getByTestId("cell-1-design")).not.toContainText("Done");
  await expect(t).toContainText("1/3 done");
  await page.reload();
  await expect(page.getByTestId("album-progress").getByTestId("cell-2-design")).toContainText("20 / 20");
});

test("albums: assign the grader per album; when every album is graded the order moves on by itself", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Engagement", sheets: 30 }, { name: "Haldi", sheets: 20 }, { name: "Muhurtham", sheets: 25 }], finalize: true }))!;
  await page.goto(`/orders/${code}`);
  await page.getByRole("button", { name: "Move to Files Received" }).click();
  await page.getByRole("button", { name: "Move to Colour Grading" }).click();
  const t = page.getByTestId("album-progress");
  await expect(t.getByTestId("assign-1-grading").locator("option", { hasText: "Karthik V — Colour Grading" })).toHaveCount(1);   // the role is shown
  await t.getByTestId("assign-1-grading").selectOption("U4");
  await expect(page.getByText("Album 1 · Colour Grading: assigned to Karthik V").first()).toBeVisible();
  await t.getByTestId("assign-2-design").selectOption({ label: "Ramesh Kumar — Designer" });
  await expect(t.getByTestId("assign-2-design")).toHaveValue("U2");
  for (const k of [1, 2, 3]) {
    await t.getByTestId(`cell-${k}-grading`).click();
    const ed = page.getByTestId(`progress-grading-album-${k}`);
    await ed.getByLabel("grading status").selectOption("done");
    await ed.getByRole("button", { name: "Update" }).click();
    await expect(t.getByTestId(`cell-${k}-grading`)).toContainText("Done");
  }
  await expect(page.getByText(`All albums done — ${code} moved to Admin Approval`).first()).toBeVisible();
  await expect(page.getByTestId("step-admin_approval")).toHaveAttribute("data-state", "current");
  await page.reload();
  await expect(page.getByTestId("album-progress").getByTestId("assign-1-grading")).toHaveValue("U4");
});

test("colour grading: an unassigned job shows the grader who started it", async ({ page }) => {
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "One", sheets: 10 }], finalize: true }))!;
  await page.goto(`/orders/${code}`);
  await page.getByRole("button", { name: "Move to Files Received" }).click();
  await page.getByRole("button", { name: "Move to Colour Grading" }).click();
  await page.goto("/colour-grading");
  await page.getByPlaceholder(/Search by order ID/).fill(code);
  await expect(page.getByTestId(`grader-${code}`)).toContainText(/Karthik V|Unassigned/);
  const before = await page.getByTestId(`grader-${code}`).innerText();
  if (before.includes("Unassigned")) {
    await page.getByTestId(`job-${code}`).getByRole("button", { name: "Start" }).click();
    await expect(page.getByTestId(`grader-${code}`)).not.toContainText("Unassigned");
    await expect(page.getByTestId("assigned-grader")).not.toHaveText("Unassigned");
  }
});

test("album-wise process: assign at order taking → graded → admin approves → designer records client approval → final approval sends albums to the lab → received → QC", async ({ page }) => {
  test.setTimeout(180_000);
  await seedRole(page, "admin");
  await page.goto("/labs");
  await page.getByRole("button", { name: "Add lab" }).click();
  await page.getByLabel("Lab name").fill("Flow Lab"); await page.getByRole("button", { name: "Save lab" }).click();
  await buildOrder(page, { albums: [{ name: "Engagement", sheets: 20 }, { name: "Haldi", sheets: 20 }], finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  for (const k of [1, 2]) {
    await page.getByRole("tab").nth(k - 1).click();
    const a = page.getByTestId(`album-${k}`);
    await a.getByLabel("Album colour grader").selectOption("U4");
    await a.getByLabel("Album designer").selectOption("U2");
    await a.getByLabel("Album lab").selectOption({ label: "Flow Lab" });
  }
  await page.getByRole("button", { name: /Finalize/ }).first().click();
  await invoiceNow(page); await page.getByRole("button", { name: /^Finalize order/ }).click();
  const code = (await page.getByTestId("finalized").locator("h2").innerText()).match(/IDP\d+/)![0];

  await page.goto(`/orders/${code}`);
  const t = page.getByTestId("album-progress");
  await expect(t.getByTestId("assign-1-grading")).toHaveValue("U4");
  await expect(t.getByTestId("assign-2-design")).toHaveValue("U2");
  const setStatus = async (k: number, dept: string, status: string) => {
    await t.getByTestId(`cell-${k}-${dept}`).click();
    const ed = page.getByTestId(`progress-${dept}-album-${k}`);
    await ed.getByLabel(`${dept} status`).selectOption(status);
    await ed.getByRole("button", { name: "Update" }).click();
    await expect(t.getByTestId(`cell-${k}-${dept}`)).toContainText(status === "done" ? "Done" : "Client approved");
  };
  await page.getByRole("button", { name: "Move to Files Received" }).click();
  await page.getByRole("button", { name: "Move to Colour Grading" }).click();
  await setStatus(1, "grading", "done"); await setStatus(2, "grading", "done");
  await expect(page.getByTestId("step-admin_approval")).toHaveAttribute("data-state", "current");   // all graded → the approver
  await page.getByRole("button", { name: "Move to Designing" }).click();                               // the approver approves
  await setStatus(1, "design", "client_approved"); await setStatus(2, "design", "client_approved");
  await expect(page.getByTestId("step-final_approval")).toHaveAttribute("data-state", "current");   // client approved every album → final approval
  await page.getByRole("button", { name: "Move to Printing" }).click();                                // admin's final approval → the lab
  await expect(t.getByTestId("lab-cell-1")).toContainText("At lab");
  await expect(t.getByTestId("lab-cell-2")).toContainText("At lab");
  await t.getByTestId("lab-cell-1").getByRole("button", { name: "Received" }).click();
  await t.getByTestId("lab-cell-2").getByRole("button", { name: "Received" }).click();
  await expect(page.getByTestId("step-qc")).toHaveAttribute("data-state", "current");                // everything back from the lab → QC
});
