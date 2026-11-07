import { test, expect } from "@playwright/test";
import { loginAs, sql } from "./helpers";

// The colour grader sees the customer's photos and uploads graded images or PDF; the designer sees the graded photos and uploads
// album pages (images or PDF). Previews open in the browser; everything lands in the order's file register.
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

test("grader works from the source photos and uploads graded images and a PDF; the designer sees them and uploads design pages", async ({ browser }) => {
  const tag = Date.now().toString(36);
  const colourId = "00000000-0000-0000-0000-0000000000a3";
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('Work ${tag}', '9${String(Date.now()).slice(-9)}', 'pending') returning id`).split("\n")[0];
  const code = sql(`insert into orders(customer_id, type, due_date, total, code) values ('${cust}', 'design_printing', current_date + 14, 1000, 'pending') returning code`).split("\n")[0]!;
  const O = `(select id from orders where code = '${code}')`;
  const ctx = () => browser.newContext({ baseURL: `http://localhost:${Number(process.env.E2E_PORT ?? 5190)}` });

  // reception adds the customer's photos on the order page
  const admin = await (await ctx()).newPage(); await loginAs(admin, "admin");
  await admin.goto(`/orders/${code}`);
  await admin.getByTestId("file-input").setInputFiles([{ name: "IMG_0001.png", mimeType: "image/png", buffer: PNG }, { name: "IMG_0002.png", mimeType: "image/png", buffer: PNG }]);
  await expect.poll(() => sql(`select count(*) from order_files where order_id = ${O} and category = 'source_photos'`)).toBe("2");
  sql(`select set_config('app.via_fn', '1', false); update orders set stage = 'colour_grading', assignee = '${colourId}' where id = ${O}`);
  sql(`insert into tasks(order_id, kind, assignee) values (${O}, 'grading', '${colourId}')`);

  // colour grader: sees the 2 photos, previews one, starts, uploads a graded image and a PDF contact sheet
  const colour = await (await ctx()).newPage(); await loginAs(colour, "colour");
  await colour.goto("/colour-grading");
  await colour.getByPlaceholder(/Search by order ID/).fill(code);
  await colour.getByTestId(`job-${code}`).getByRole("button", { name: "Start" }).click();
  await expect.poll(() => sql(`select status from tasks where order_id = ${O} and kind = 'grading'`)).toBe("in_progress");
  if (!(await colour.getByTestId("work-files").isVisible())) await colour.getByTestId(`job-${code}`).click();
  const src = colour.getByTestId("inputs-Source Photos");
  await expect(src.getByTestId("work-file")).toHaveCount(2);
  await expect(src.locator("img").first()).toBeVisible();                                         // a real thumbnail
  await src.getByRole("button", { name: "Preview IMG_0001.png" }).click();
  await expect(colour.getByTestId("file-preview").locator("img")).toBeVisible();
  await colour.getByRole("button", { name: "Close preview" }).click();
  await colour.getByTestId("work-input").setInputFiles([{ name: "IMG_0001_graded.png", mimeType: "image/png", buffer: PNG }, { name: "contact-sheet.pdf", mimeType: "application/pdf", buffer: PDF }]);
  await expect.poll(() => sql(`select string_agg(ext, ',' order by ext) from order_files where order_id = ${O} and category = 'graded'`)).toBe("pdf,png");
  await expect(colour.getByTestId("outputs-Graded").getByTestId("work-file")).toHaveCount(2);
  await colour.getByTestId("outputs-Graded").getByRole("button", { name: "Preview contact-sheet.pdf" }).click();
  await expect(colour.getByTestId("file-preview").locator("iframe")).toBeVisible();              // PDFs open in the viewer
  await colour.getByRole("button", { name: "Close preview" }).click();

  // designer: sees the graded photos and uploads two album pages (image + PDF)
  sql(`update orders set stage = 'designing' where id = ${O}`);
  const designer = await (await ctx()).newPage(); await loginAs(designer, "designer");
  await designer.goto(`/designing/${code}`);
  await expect(designer.getByTestId("inputs-Graded").getByTestId("work-file")).toHaveCount(2);
  await designer.getByTestId("work-input").setInputFiles([{ name: "spread-01.png", mimeType: "image/png", buffer: PNG }, { name: "album.pdf", mimeType: "application/pdf", buffer: PDF }]);
  await expect.poll(() => sql(`select count(*) from order_files where order_id = ${O} and category = 'design_draft'`)).toBe("2");
  await expect(designer.getByTestId("outputs-Design Draft").getByTestId("work-file")).toHaveCount(2);
  // a wrong type is refused with a clear message
  await designer.getByTestId("work-input").setInputFiles({ name: "notes.docx", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await expect(designer.getByText(/notes\.docx — upload images \(JPG, PNG, TIFF\), PDF or PSD/).first()).toBeVisible();
});
