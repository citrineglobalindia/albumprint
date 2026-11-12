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

test("colour grading in sittings: pending shown clearly; when every photo is graded the job goes to the admin by itself", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Sitting album", sheets: 30 }], finalize: true, photosGiven: "400" }))!;
  await page.goto(`/orders/${code}`);
  await page.getByRole("button", { name: "Move to Files Received" }).click();
  await page.getByRole("button", { name: "Move to Colour Grading" }).click();
  await page.goto("/colour-grading");
  await page.getByPlaceholder(/Search by order ID/).fill(code);
  const start = page.getByTestId(`job-${code}`).getByRole("button", { name: "Start" });
  if (await start.count()) await start.click(); else await page.getByTestId(`job-${code}`).click();
  const g = page.getByTestId("progress-grading");
  // day 1: 280 of 400
  await g.getByLabel("Add more done now").fill("280"); await g.getByRole("button", { name: "Add" }).click();
  await expect(g.getByTestId("progress-grading-pending")).toContainText("Photos graded: 280 of 400");
  await expect(g.getByTestId("progress-grading-pending")).toContainText("120 pending");
  await expect(page.getByTestId("step-admin_approval")).toHaveCount(0);
  // day 2: the rest → submitted to the admin automatically
  await g.getByLabel("Add more done now").fill("120"); await g.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText(`All 400 photos graded — ${code} sent to the admin for approval`).first()).toBeVisible();
  await page.goto(`/orders/${code}`);
  await expect(page.getByTestId("step-admin_approval")).toHaveAttribute("data-state", "current");
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

test("Album Designing lists one row per album; the designer sees the albums assigned to them", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Engagement", sheets: 20 }, { name: "Haldi", sheets: 15 }, { name: "Muhurtham", sheets: 25 }, { name: "Reception", sheets: 30 }], finalize: true }))!;
  await page.goto(`/orders/${code}`);
  const t = page.getByTestId("album-progress");
  for (const k of [1, 2, 3]) await t.getByTestId(`assign-${k}-design`).selectOption("U2");             // Ramesh Kumar: three albums
  await t.getByTestId("assign-4-design").selectOption("U1");                                              // someone else: the fourth
  for (const b of ["Move to Files Received", "Move to Colour Grading", "Move to Admin Approval", "Move to Designing"]) await page.getByRole("button", { name: b }).click();
  await page.goto("/designing");
  await page.getByPlaceholder(/Search by order ID/).fill(code);
  await expect(page.getByTestId(`djob-${code}`)).toContainText("Engagement");
  await expect(page.getByTestId(`djob-${code}-4`)).toContainText("Reception");                          // admin: every album
  await page.evaluate(() => { localStorage.setItem("albumpro.role", "designer"); });
  await page.goto("/designing");
  await page.getByPlaceholder(/Search by order ID/).fill(code);
  await expect(page.getByTestId(`djob-${code}`)).toContainText("Engagement");
  await expect(page.getByTestId(`djob-${code}-2`)).toContainText("Haldi");
  await expect(page.getByTestId(`djob-${code}-3`)).toContainText("Muhurtham");
  await expect(page.getByTestId(`djob-${code}-4`)).toHaveCount(0);                                       // not theirs
  // each album has its own Start; the order shows its total progress
  await expect(page.getByTestId(`djob-${code}-2`)).toContainText(code);
  await page.getByTestId(`dstart-${code}-2`).click();
  await expect(page.getByTestId(`djob-${code}-2`)).toContainText("Working on it");
  await expect(page.getByTestId(`dstart-${code}-1`)).toBeVisible();                                     // the other albums still wait to be started
  const ed = page.getByTestId("progress-design-album-2").first();
  await ed.getByLabel("Sheets designed").fill("15"); await ed.getByLabel("design status").selectOption("done");
  await ed.getByRole("button", { name: "Update" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(`dprogress-${code}-1`)).toContainText("1/4 albums done · 15/90 sheets");
  await expect(page.getByTestId(`dprogress-${code}-1`)).toContainText("17%");
});

test("Orders list: each album of a multi-album order on its own line with grading / design / lab status and the order's progress", async ({ page }) => {
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Engagement", sheets: 20 }, { name: "Haldi", sheets: 15 }], finalize: true }))!;
  await page.goto(`/orders/${code}`);
  const t = page.getByTestId("album-progress");
  await t.getByTestId("assign-1-design").selectOption("U2");
  await t.getByTestId("cell-1-grading").click();
  const ed = page.getByTestId("progress-grading-album-1");
  await ed.getByLabel("grading status").selectOption("done"); await ed.getByRole("button", { name: "Update" }).click();
  await expect(t.getByTestId("cell-1-grading")).toContainText("Done");
  await page.goto("/design-orders");
  await expect(page.getByTestId(`order-album-${code}-1`)).toContainText("Engagement");
  await expect(page.getByTestId(`order-album-${code}-1`)).toContainText("Done");
  await expect(page.getByTestId(`order-album-${code}-1`)).toContainText("Ramesh Kumar");
  await expect(page.getByTestId(`order-album-${code}-2`)).toContainText("Haldi");
  await expect(page.getByTestId(`order-albums-${code}`)).toContainText("Graded 1/2");
  await expect(page.getByTestId(`order-albums-${code}`)).toContainText("50%");
  await page.getByTestId("toggle-albums").click();
  await expect(page.getByTestId(`order-album-${code}-1`)).toHaveCount(0);
});

test("My Jobs: the designer sees each assigned album with its own Start (every album starts); the admin's list shows grading done once the order is past it", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Engagement", sheets: 20 }, { name: "Haldi", sheets: 15 }], finalize: true, photosGiven: "500" }))!;
  await page.goto(`/orders/${code}`);
  const t = page.getByTestId("album-progress");
  await t.getByTestId("assign-1-design").selectOption("U2"); await t.getByTestId("assign-2-design").selectOption("U2");
  await expect(t.getByTestId("assign-2-design")).toHaveValue("U2");
  for (const b of ["Move to Files Received", "Move to Colour Grading", "Move to Admin Approval", "Move to Designing"]) await page.getByRole("button", { name: b }).click();
  await page.goto("/design-orders");
  await expect(page.getByTestId(`order-album-${code}-1`)).toContainText("Done");                  // grading: the order is past it
  await expect(page.getByTestId(`order-albums-${code}`)).toContainText("Graded 500/500 photos");

  await page.evaluate(() => { localStorage.setItem("albumpro.role", "designer"); });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "My Jobs" })).toBeVisible();
  await page.getByRole("link", { name: "My Jobs" }).click();
  await expect(page.getByTestId(`myjob-${code}-design-1`)).toContainText("Engagement");
  await expect(page.getByTestId(`myjob-${code}-design-2`)).toContainText("Haldi");
  await page.getByTestId(`mystart-${code}-design-1`).click();
  await expect(page.getByTestId(`myjob-${code}-design-1`)).toContainText("Working on it");
  await page.getByTestId(`mystart-${code}-design-2`).click();                                     // the second album starts too
  await expect(page.getByTestId(`myjob-${code}-design-2`)).toContainText("Working on it");
  const ed = page.getByTestId("progress-design-album-2");
  await ed.getByLabel("Sheets designed").fill("15"); await ed.getByLabel("design status").selectOption("done");
  await ed.getByRole("button", { name: "Update" }).click();
  await expect(page.getByTestId(`myjob-${code}-design-2`)).toHaveCount(0);                       // done → the Done tab
  await page.getByRole("tab", { name: /Done/ }).click();
  await expect(page.getByTestId(`myjob-${code}-design-2`)).toContainText("15");
});
