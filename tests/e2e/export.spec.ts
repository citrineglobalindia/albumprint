import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { seedRole } from "./helpers";

// Reports export real Excel (.xlsx) and PDF files, not just CSV.
test.beforeEach(async ({ page }) => { await seedRole(page, "admin"); await page.goto("/reports"); });

test("Excel export is a valid workbook with the report rows", async ({ page }) => {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Excel", exact: true }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^report-.*\.xlsx$/);
  const path = `${tmpdir()}/albumpro-export-${Date.now()}.xlsx`;
  await dl.saveAs(path);
  expect(readFileSync(path).subarray(0, 2).toString()).toBe("PK");                       // a zip container
  const out = execFileSync("python3", ["-c", "import sys, openpyxl; ws = openpyxl.load_workbook(sys.argv[1]).active; print(ws.max_row, ws['A1'].value, ws['A1'].font.b)", path]).toString().trim();
  expect(out).toMatch(/^\d+ Report /);
  expect(Number(out.split(" ")[0])).toBeGreaterThan(3);
});

test("PDF export is a valid, readable PDF", async ({ page }) => {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF", exact: true }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^report-.*\.pdf$/);
  const buf = readFileSync((await dl.path())!);
  expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  const txt = execFileSync("python3", ["-c", "import sys, pypdf; r = pypdf.PdfReader(sys.argv[1]); print(len(r.pages)); print(r.pages[0].extract_text()[:300])", (await dl.path())!]).toString();
  expect(txt).toContain("report");
});

test("a scheduled report is saved, survives a reload, downloads on demand and can be removed", async ({ page }) => {
  await page.getByText("Custom Report", { exact: true }).first().click();
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page.getByPlaceholder("owner@studio.com, accounts@studio.com").fill("accounts@studio.com");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText(/scheduled weekly at/i).first()).toBeVisible();
  await page.reload();
  await page.getByText("Custom Report", { exact: true }).first().click();
  await expect(page.getByText("accounts@studio.com")).toBeVisible();                       // kept after a reload
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download Custom report now$/ }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.csv$/);
  await page.getByRole("button", { name: /^Remove schedule Custom report$/ }).click();
  await expect(page.getByText("accounts@studio.com")).toHaveCount(0);
});
