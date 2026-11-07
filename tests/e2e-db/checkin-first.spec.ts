import { test, expect } from "@playwright/test";
import { loginAs, sql } from "./helpers";

// Attendance first: staff land on Attendance after signing in, can't work on jobs until checked in (the bar offers a one-click
// check-in), breaks pause work, and the day shows checked-in time against time on jobs. The rule is switched on just for this test.
const colourId = "00000000-0000-0000-0000-0000000000a3";
const clearToday = () => sql(`set session_replication_role = replica; delete from attendance_events where user_id = '${colourId}' and work_date = (now() at time zone 'Asia/Kolkata')::date`);

test.beforeAll(() => { sql(`update settings set value = value || '{"wf_require_checkin": true}' where key = 'workflow'`); clearToday(); });
test.afterAll(() => { sql(`update settings set value = value || '{"wf_require_checkin": false}' where key = 'workflow'`); clearToday(); });

test("a grader starts the day on Attendance, must check in to start a job, and sees the job time against the day", async ({ browser }) => {
  const tag = Date.now().toString(36);
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('Duty ${tag}', '9${String(Date.now()).slice(-9)}', 'pending') returning id`).split("\n")[0];
  const code = sql(`insert into orders(customer_id, type, due_date, total, code) values ('${cust}', 'design_printing', current_date + 14, 1000, 'pending') returning code`).split("\n")[0]!;
  const O = `(select id from orders where code = '${code}')`;
  sql(`select set_config('app.via_fn', '1', false); update orders set stage = 'colour_grading', assignee = '${colourId}' where id = ${O}`);
  sql(`insert into tasks(order_id, kind, assignee) values (${O}, 'grading', '${colourId}')`);
  const ctx = () => browser.newContext({ baseURL: `http://localhost:${Number(process.env.E2E_PORT ?? 5190)}` });

  const p = await (await ctx()).newPage();
  await loginAs(p, "colour");
  await expect(p).toHaveURL(/\/attendance$/);                                                       // attendance first
  await expect(p.getByRole("link", { name: "Attendance" }).first()).toBeVisible();

  // not checked in: the bar says so and the job can't start (the app says so, and so would the database)
  await p.goto("/colour-grading");
  await expect(p.getByTestId("duty-bar")).toHaveAttribute("data-state", "not_in");
  await p.getByPlaceholder(/Search by order ID/).fill(code);
  await p.getByTestId(`job-${code}`).getByRole("button", { name: "Start" }).click();
  await expect(p.getByText(/Check in first: you are not checked in for today/).first()).toBeVisible();
  expect(sql(`select status from tasks where order_id = ${O} and kind = 'grading'`)).toBe("pending");

  // one click checks in; the job starts
  await p.keyboard.press("Escape");
  await p.getByTestId("duty-bar").getByRole("button", { name: "Check in now" }).click();
  await expect(p.getByTestId("duty-bar")).toHaveCount(0);
  expect(sql(`select kind from attendance_events where user_id = '${colourId}' and work_date = (now() at time zone 'Asia/Kolkata')::date order by at desc limit 1`)).toBe("check_in");
  await p.getByTestId(`job-${code}`).getByRole("button", { name: "Start" }).click();
  await expect.poll(() => sql(`select status from tasks where order_id = ${O} and kind = 'grading'`)).toBe("in_progress");

  // My day: the running job is listed against the checked-in time
  await p.goto("/attendance");
  await expect(p.getByTestId("work-today")).toBeVisible();
  await expect(p.getByTestId("wt-list")).toContainText(code);
  await expect(p.getByTestId("wt-list")).toContainText("Colour Grading");

  // a break pauses work, everywhere
  await p.getByRole("button", { name: "Start break" }).click();
  await p.goto("/colour-grading");
  await expect(p.getByTestId("duty-bar")).toHaveAttribute("data-state", "on_break");
  await p.getByPlaceholder(/Search by order ID/).fill(code);
  await p.getByTestId(`job-${code}`).click();
  await p.getByRole("button", { name: /Submit to Admin/ }).click();
  await expect(p.getByText(/You are on a break/).first()).toBeVisible();
  expect(sql(`select status from tasks where order_id = ${O} and kind = 'grading'`)).toBe("in_progress");
  await p.keyboard.press("Escape");
  await p.getByTestId("duty-bar").getByRole("button", { name: "End break" }).click();
  await expect(p.getByTestId("duty-bar")).toHaveCount(0);

  // the admin is never blocked and sees each person's job time on the team board
  const a = await (await ctx()).newPage();
  await loginAs(a, "admin");
  await expect(a).toHaveURL(/localhost:\d+\/$/);                                                    // admins keep the Dashboard
  await expect(a.getByTestId("duty-bar")).toHaveCount(0);
  await a.goto("/attendance");
  await a.getByRole("tab", { name: "Team" }).click();
  await expect(a.getByTestId("today-board").getByRole("button").filter({ hasText: "Karthik V" }).getByTestId("team-jobs")).toBeVisible();
});
