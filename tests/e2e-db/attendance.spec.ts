import { test, expect } from "@playwright/test";
import { loginAs, sql } from "./helpers";

// Attendance ledger in the database: server-stamped punches, immutable rows, admin corrections with a reason, and leave approval.
test("staff punch through the database; the ledger is append-only; admin corrects a day and approves leave", async ({ browser }) => {
  test.setTimeout(150_000);
  const emp = "reception@albumpro.local";
  const uid = sql(`select id from profiles where email = '${emp}'`);
  sql(`update attendance_settings set shift_start = '00:01', grace_minutes = 180`);       // so the test is not "late" whatever time it runs

  // 1. the employee checks in, takes a break, checks out
  const c1 = await browser.newContext(); const p1 = await c1.newPage();
  await loginAs(p1, "reception");
  await p1.goto("/attendance");
  const today = p1.getByTestId("today-card");
  const stamp = String(Date.now());                                                       // the ledger is append-only, so earlier runs leave rows behind
  const before = Number(sql(`select count(*) from attendance_events where user_id = '${uid}' and work_date = (now() at time zone 'Asia/Kolkata')::date`));
  await today.getByLabel("Note (optional)").fill(`front desk ${stamp}`);
  await today.getByRole("button", { name: /^Check in( again)?$/ }).click();
  await expect(today.getByText("Working")).toBeVisible();
  await today.getByRole("button", { name: "Start break" }).click();
  await expect(today.getByText("On break")).toBeVisible();
  await today.getByRole("button", { name: "End break" }).click();
  await today.getByRole("button", { name: "Check out" }).click();
  await expect(p1.getByTestId("timeline").getByRole("listitem")).toHaveCount(before + 4);
  expect(sql(`select string_agg(kind, ',' order by seq) from (select kind, seq from attendance_events where user_id = '${uid}' order by seq desc limit 4) x`)).toBe("check_in,break_start,break_end,check_out");
  expect(sql(`select note from attendance_events where user_id = '${uid}' and kind = 'check_in' and source = 'web' order by seq desc limit 1`)).toBe(`front desk ${stamp}`);

  // 2. it is all still there after a reload (it comes from the database)
  await p1.reload();
  await expect(p1.getByTestId("timeline").getByRole("listitem")).toHaveCount(before + 4);

  // 3. the ledger cannot be edited, even by a database owner
  let blocked = "";
  try { sql(`update attendance_events set at = at - interval '2 hours' where user_id = '${uid}'`); } catch (e) { blocked = String(e); }
  expect(blocked).toContain("cannot be edited");

  // 4. the employee files a leave request; the admin approves it
  await p1.getByRole("tab", { name: /^Leave/ }).click();
  const d = new Date(); d.setDate(d.getDate() + 5 + (Number(stamp) % 80));
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  await p1.getByLabel("Leave from").fill(iso); await p1.getByLabel("Leave to").fill(iso);
  await p1.getByLabel("Leave reason").fill(`family function ${stamp}`);
  await p1.getByRole("button", { name: "Send request" }).click();
  await expect(p1.getByText("Leave request sent").first()).toBeVisible();
  expect(sql(`select status from attendance_leaves where reason = 'family function ${stamp}' and user_id = '${uid}'`)).toBe("pending");

  const c2 = await browser.newContext(); const p2 = await c2.newPage();
  await loginAs(p2, "admin");
  await p2.goto("/attendance");
  await p2.getByRole("tab", { name: /^Leave/ }).click();
  const req = p2.getByRole("row").filter({ hasText: `family function ${stamp}` }).first();
  await req.getByLabel(/^Note for/).fill("enjoy");
  await req.getByRole("button", { name: "Approve" }).click();
  await expect(p2.getByText("Leave approved").first()).toBeVisible();
  expect(sql(`select status || ':' || coalesce(decision_note, '') from attendance_leaves where reason = 'family function ${stamp}' and user_id = '${uid}'`)).toBe("approved:enjoy");
  expect(Number(sql(`select count(*) from notifications where title = 'Leave approved' and body like '%enjoy%' and user_id = '${uid}'`))).toBeGreaterThanOrEqual(1);

  // 5. the admin sees the team register and corrects yesterday for the employee, with a reason
  await p2.getByRole("tab", { name: "Team" }).click();
  await expect(p2.getByTestId("register").getByText("Priya N")).toBeVisible();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(y);
  await p2.getByRole("button", { name: new RegExp(`^Priya N ${yIso} `) }).click();
  const sheet = p2.getByRole("dialog");
  await sheet.getByLabel("Check-in time").fill("09:10");
  await sheet.getByLabel("Check-out time").fill("18:40");
  await sheet.getByLabel("Reason for correction").fill("forgot to punch");
  await sheet.getByRole("button", { name: "Save correction" }).click();
  await expect(p2.getByRole("dialog")).toHaveCount(0);
  expect(sql(`select count(*) from attendance_events where user_id = '${uid}' and work_date = '${yIso}' and source = 'admin' and superseded_at is null`)).toBe("2");
  expect(Number(sql(`select count(*) from audit_log where entity = 'attendance_events' and new_data->>'reason' = 'forgot to punch' and new_data->>'work_date' = '${yIso}'`))).toBeGreaterThanOrEqual(2);

  // 6. the employee's ledger shows the corrected day and the leave
  await p1.getByRole("tab", { name: "My attendance" }).click();
  await p1.reload();
  const row = p1.getByTestId(`ledger-${yIso}`);
  await expect(row.getByText("09:10")).toBeVisible();
  await expect(row.getByText("edited")).toBeVisible();
  await c1.close(); await c2.close();
});
