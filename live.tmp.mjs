import { chromium } from "@playwright/test";
const base = "https://albumprint.vercel.app";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push("PAGEERR " + String(e).slice(0, 120))); p.on("response", r => { if (r.status() >= 400 && !r.url().includes("favicon")) errs.push(`HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 90)}`); });
await p.goto(base + "/login", { waitUntil: "networkidle" });
await p.getByLabel(/work email/i).fill("citrineglobalindia@gmail.com"); await p.locator("input[type=password]").fill("Sadwin@0320");
await p.getByRole("button", { name: "Sign in", exact: true }).click();
await p.waitForURL(u => !u.pathname.includes("login")); await p.waitForLoadState("networkidle");
const routes = ["/","/orders","/customers","/pipeline","/colour-grading","/designing","/printing","/qc","/delivery","/payments","/invoices","/reports","/masters","/users","/settings","/control","/files","/notifications","/audit"];
for (const r of routes) {
  const before = errs.length;
  await p.goto(base + r, { waitUntil: "networkidle" }); await p.waitForTimeout(400);
  const h1 = await p.locator("h1").first().textContent().catch(() => null);
  const empty = await p.getByText(/no (orders|customers|records|results|data)|nothing here|no matches/i).count();
  console.log(r.padEnd(16), "|", (h1 ?? "—").slice(0, 28).padEnd(28), "| empty-text:", empty, "|", errs.slice(before).join(" ; ") || "ok");
}
// is the latest build live?
await p.goto(base + "/orders", { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Create Order" }).first().click();
console.log("wizard steps:", await p.getByRole("dialog", { name: "New Order" }).locator("ol li").allTextContents());
await b.close();
