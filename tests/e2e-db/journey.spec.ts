import { randomBytes } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAs, sql, type Role } from "./helpers";

// The whole production process for one Design + Printing order, every step done by the role that owns it, each logged in separately:
//   reception creates the order → files received → colour grading (auto-assigned; the grader starts, uploads, submits)
//   → admin approval → designing (auto-assigned; the designer sends the proof) → the client approves in the portal
//   → admin final approval + release to printing → printing (auto-assigned; the printer walks the job) → QC (auto-assigned; checks + remarks)
//   → ready for delivery. Every hand-off is checked in the database: stage, assignee, job, notification.
const PORT = Number(process.env.E2E_PORT ?? 5190);
const TAG = Date.now().toString(36);
const CHECKS = ["Print quality", "Colour accuracy", "Alignment & trim", "Binding", "Cover & finish", "Specification match", "Packaging"];
const ids = { colour: "00000000-0000-0000-0000-0000000000a3", designer: "00000000-0000-0000-0000-0000000000a4", printing: "00000000-0000-0000-0000-0000000000a5", qc: "00000000-0000-0000-0000-0000000000a6" };
let code = "";
const db = (q: string) => sql(q.replaceAll("$O", `(select id from orders where code = '${code}')`));
const stage = () => db(`select stage from orders where id = $O`);
const assignee = () => db(`select coalesce(assignee::text, '') from orders where id = $O`);
async function as(browser: Browser, role: Role): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: `http://localhost:${PORT}` }); const page = await ctx.newPage(); await loginAs(page, role); return page;
}
const next = (p: Page) => p.getByRole("button", { name: "Next" }).click();

let saved = { mode: "", rules: "" };
test.beforeAll(() => {
  saved = { mode: sql(`select printing_mode from pricing_settings`), rules: sql(`select coalesce((select value::text from settings where key = 'auto_assign'), '{}')`) };
  // a priced product to sell, printing included in the sheet price
  sql(`update pricing_settings set printing_mode = 'included'`);
  sql(`select cat_import_tree('[{"path":["Journey ${TAG}","NT","125 GSM"],"item":"Glossy","method":"per_sheet","unit":"sheet"}]'::jsonb)`);
  sql(`update cat_items set rate = 75 where name = 'Glossy' and category_id in (select id from cat_categories where name = '125 GSM' and parent_id in (select id from cat_categories where name = 'NT' and parent_id = (select id from cat_categories where name = 'Journey ${TAG}')))`);
  sql(`update settings set value = '{}' where key = 'auto_assign'`);
});
test.afterAll(() => {
  sql(`update pricing_settings set printing_mode = '${saved.mode || "separate"}'`);
  sql(`update settings set value = '${saved.rules.replaceAll("'", "''")}'::jsonb where key = 'auto_assign'`);
});

test("the full process: every department does its step, hand-offs are automatic and recorded", async ({ browser }) => {
  test.setTimeout(420_000);

  // ── admin: auto-assign for every department (Settings › Workflow)
  const admin = await as(browser, "admin");
  await admin.goto("/settings");
  await admin.getByRole("button", { name: /^Workflow/ }).first().click();
  const aa = admin.getByTestId("auto-assign-settings");
  // "always this person" for each department (the full suite adds more staff of each role; least-busy is covered by the SQL tests)
  for (const [d, id] of [["Colour Grading", ids.colour], ["Designing", ids.designer], ["Printing", ids.printing], ["Quality Control", ids.qc]] as const) {
    await aa.getByLabel(`Auto-assign ${d}`).selectOption("person"); await aa.getByLabel(`Person for ${d}`).selectOption(id);
  }
  await aa.getByRole("button", { name: "Save auto-assign" }).click();
  await expect(admin.getByText("Auto-assign rules saved").first()).toBeVisible();
  expect(sql(`select (value->'colour_grading'->>'mode') || ',' || (value->'qc'->>'mode') from settings where key = 'auto_assign'`)).toBe("person,person");

  // ── reception: creates the order (Design + Printing)
  const reception = await as(browser, "reception");
  await reception.goto("/design-orders");
  await reception.getByRole("button", { name: "New Design + Printing order" }).click();
  await reception.getByRole("button", { name: "New customer" }).click();
  await reception.getByLabel("Customer name").fill(`Journey ${TAG}`);
  await reception.getByLabel("Phone number").fill("9876501234");
  await next(reception);
  // order taken yesterday (an earlier day can be picked); no event date (optional)
  const yesterday = new Date(Date.now() - 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);
  await expect(reception.getByLabel("Order date")).toHaveValue(new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10));   // today by default
  await reception.getByLabel("Event Wedding").check(); await reception.getByLabel("Event Reception").check(); await reception.getByLabel("Couple name").fill("Asha & Ravi"); await reception.getByLabel("Order date").fill(yesterday); await next(reception);
  const a1 = reception.getByTestId("album-1");
  await a1.getByLabel("Album name").fill("Main album"); await a1.getByLabel("Album event date").fill("2026-12-20"); await a1.getByLabel("Sheets", { exact: true }).fill("30");
  await a1.getByLabel("Design charge type").selectOption("fixed"); await a1.getByLabel("Design charge", { exact: true }).fill("3000");
  const t = reception.getByTestId("album-items-1");
  await t.getByRole("button", { name: "Add item" }).click();
  await t.getByLabel("New line product").fill(`journey ${TAG} glossy`); await t.getByLabel("New line product").press("Enter");
  await expect(reception.getByTestId("album-total-1")).toHaveText("₹5,250");                                 // 30 × 75 + 3,000 design
  await next(reception); await next(reception);
  await reception.getByRole("button", { name: /^Finalize order/ }).click();
  await expect(reception.getByTestId("finalized")).toBeVisible();
  code = (await reception.getByTestId("finalized").locator("h2").innerText()).match(/IDP\d+/)![0];
  expect(stage()).toBe("new_order");
  expect(db(`select order_date::text || '|' || coalesce(event_date::text, 'none') from orders where id = $O`)).toBe(`${yesterday}|none`);
  expect(db(`select event_date::text from order_albums where order_id = $O and position = 1`)).toBe("2026-12-20");   // the album's own event date

  // ── reception: files received, then sends it to colour grading — auto-assigned to the colour grader, grading job created
  await reception.goto(`/orders/${code}`);
  await reception.getByRole("button", { name: "Move to Files Received" }).click();
  await expect.poll(stage).toBe("files_received");
  await reception.getByRole("button", { name: "Move to Colour Grading" }).click();
  await expect.poll(stage).toBe("colour_grading");
  await expect.poll(assignee).toBe(ids.colour);
  expect(db(`select assignee::text || '|' || status from tasks where order_id = $O and kind = 'grading'`)).toBe(`${ids.colour}|pending`);
  expect(db(`select count(*) from notifications where user_id = '${ids.colour}' and title = 'Job assigned to you' and body like '%${code}%'`)).toBe("1");

  // the order page's process tracker (admin): Colour Grading is in progress, with the grader; reception did the first steps
  await admin.goto(`/orders/${code}`);
  await expect(admin.getByTestId("step-colour_grading")).toHaveAttribute("data-state", "current");
  await expect(admin.getByTestId("step-colour_grading").getByTestId("step-assignee")).not.toContainText("Not assigned");
  await expect(admin.getByTestId("step-files_received").getByTestId("step-by")).toContainText("(Reception)");
  await expect(admin.getByTestId("open-step")).toHaveAttribute("href", "/colour-grading");

  // ── colour grader: sees the job, starts, uploads the graded files, submits → admin approval
  const colour = await as(browser, "colour");
  await colour.goto("/colour-grading");
  await colour.getByPlaceholder(/Search by order ID/).fill(code);
  await colour.getByTestId(`job-${code}`).getByRole("button", { name: "Start" }).click();
  await expect.poll(() => db(`select status from tasks where order_id = $O and kind = 'grading'`)).toBe("in_progress");
  // start time recorded and the timer is running (it ticks every second)
  if (!(await colour.getByTestId("job-timer").isVisible())) await colour.getByTestId(`job-${code}`).click();
  await expect(colour.getByTestId("job-timer").getByTestId("timer-start")).toContainText("Today");
  await expect(colour.getByTestId("job-timer").getByTestId("timer-end")).toContainText("Running");
  const t1 = await colour.getByTestId("job-timer").getByTestId("elapsed").innerText();
  await expect(colour.getByTestId("job-timer").getByTestId("elapsed")).not.toHaveText(t1, { timeout: 4000 });
  await expect(colour.getByTestId(`job-${code}`).getByTestId("elapsed")).toHaveAttribute("data-running", "true");
  await colour.getByTestId("work-input").setInputFiles({ name: "graded.zip", mimeType: "application/zip", buffer: randomBytes(1500) });
  await expect(colour.getByTestId("outputs-Graded")).toContainText("graded.zip");
  await colour.getByRole("button", { name: /Submit to Admin/ }).click();
  await expect.poll(stage).toBe("admin_approval");

  // ── admin: approves the grading → designing, auto-assigned to the designer
  await admin.goto("/colour-grading");
  await admin.getByRole("tab", { name: /Submitted/ }).click();
  await admin.getByPlaceholder(/Search by order ID/).fill(code);
  await admin.getByRole("button", { name: `Approve ${code}` }).click();
  await expect.poll(stage).toBe("designing");
  await expect.poll(assignee).toBe(ids.designer);
  expect(db(`select count(*) from notifications where user_id = '${ids.designer}' and title = 'Job assigned to you' and body like '%${code}%'`)).toBe("1");

  // ── designer: sends the proof to the client → client review
  const designer = await as(browser, "designer");
  await designer.goto(`/designing/${code}`);
  await designer.getByRole("button", { name: /Send for Client Review/ }).click();
  await designer.getByRole("button", { name: "Send proof" }).click();
  const link = designer.getByTestId("proof-link").first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  await expect.poll(stage).toBe("client_review");

  // ── client: opens the link (not logged in) and approves
  const cctx = await browser.newContext({ baseURL: `http://localhost:${PORT}` }); const client = await cctx.newPage();
  await client.goto(href);
  await client.getByRole("button", { name: "Approve album" }).click();
  await client.getByLabel("Your full name").fill("Journey Client");
  await client.getByRole("checkbox").check();
  await client.getByRole("button", { name: "Confirm approval" }).click();
  await expect(client.getByText("Thank you - album approved!")).toBeVisible();
  await cctx.close();
  expect(db(`select status from proofs where order_id = $O order by version desc limit 1`)).toBe("approved");

  // ── admin: final approval, then release to printing → auto-assigned to the printer, print job created
  await admin.goto(`/orders/${code}`);
  await admin.getByRole("button", { name: "Move to Final Approval" }).click();
  await expect.poll(stage).toBe("final_approval");
  await admin.goto("/printing");
  await admin.getByRole("button", { name: "Release to Printing" }).click();
  await admin.getByRole("button", { name: /Search order or customer/ }).click();
  await admin.getByPlaceholder("Type to search…").fill(code);
  await admin.getByRole("button", { name: new RegExp(code) }).first().click();
  await admin.getByRole("button", { name: "Release", exact: true }).last().click();
  await expect.poll(stage).toBe("printing");
  await expect.poll(assignee).toBe(ids.printing);

  // ── printer: walks the print job through every stage and sends it to QC → auto-assigned to QC
  const printing = await as(browser, "printing");
  await printing.goto("/printing");
  await printing.getByPlaceholder(/Search order, customer/).fill(code);
  await printing.getByTestId(`pjob-${code}`).click();
  for (const l of ["File Prep", "Printing", "Finishing", "Assembly", "Packaging", "Completed"]) { await expect(printing.getByTestId("advance")).toContainText(l); await printing.getByTestId("advance").click(); }
  await expect(printing.getByTestId("job-timer").getByTestId("timer-end")).toContainText("Today");           // printing finished: end time + time taken
  await expect(printing.getByTestId("job-timer")).toContainText("Printing time taken");
  await expect(printing.getByTestId("advance")).toContainText("Send to QC"); await printing.getByTestId("advance").click();
  await expect.poll(stage).toBe("qc");
  await expect.poll(assignee).toBe(ids.qc);
  expect(Number(db(`select count(*) from print_stage_log where order_id = $O`))).toBeGreaterThanOrEqual(7);

  // ── QC: inspects, every check passes, writes remarks → ready for delivery
  const qc = await as(browser, "qc");
  await qc.goto("/qc");
  await qc.getByTestId(`qc-${code}`).click();
  await qc.getByRole("button", { name: /Start inspection/ }).click();
  await expect(qc.getByTestId("job-timer").getByTestId("timer-end")).toContainText("Running");               // inspection timer running
  for (const c of CHECKS) await qc.getByRole("button", { name: `${c} pass`, exact: true }).click();
  await qc.getByLabel("Inspector notes").fill("All 30 sheets checked, colours match the proof, binding firm.");
  await qc.getByRole("button", { name: /Pass → Ready for Delivery/ }).click();
  await expect.poll(() => db(`select stage || '|' || qc_status from orders where id = $O`)).toBe("ready_for_delivery|passed");
  expect(db(`select decision || '|' || notes from qc_inspections where order_id = $O`)).toBe("passed|All 30 sheets checked, colours match the proof, binding firm.");

  // ── the order page shows who did every step (read by a non-admin: reception)
  await reception.goto(`/orders/${code}`);
  const owners: [string, string][] = [["new_order", "Reception"], ["files_received", "Reception"], ["colour_grading", "Colour Grading"], ["admin_approval", "Admin"],
    ["designing", "Designer"], ["client_review", "Admin"], ["final_approval", "Admin"], ["printing", "Printing"], ["qc", "QC"]];
  for (const [st, who] of owners) {
    await expect(reception.getByTestId(`step-${st}`)).toHaveAttribute("data-state", "done");
    await expect(reception.getByTestId(`step-${st}`).getByTestId("step-by")).toContainText(`(${who})`);
  }
  await expect(reception.getByTestId("step-ready_for_delivery")).toHaveAttribute("data-state", "current");
  await expect(reception.getByTestId("your-turn")).toHaveAttribute("href", "/delivery");

  // ── the record: every step happened, in order, by the right people
  const trail = db(`select string_agg((new_data->>'stage') || ':' || coalesce(actor_role::text, 'system'), ' > ' order by at, id) from audit_log
    where entity = 'orders' and entity_id = ($O)::text and action = 'update' and old_data->>'stage' is distinct from new_data->>'stage'`);
  expect(trail).toBe(["files_received:reception", "colour_grading:reception", "admin_approval:colour", "designing:admin", "client_review:designer",
    "final_approval:admin", "printing:admin", "qc:printing", "ready_for_delivery:qc"].join(" > "));
});
