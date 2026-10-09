// Shared mock data for the admin UI. Replace with API calls when the backend lands.
// Dates are ISO strings; "today" in the mock world is 3 Oct 2026 (see format.ts).

export type StageKey =
  | "new_order" | "files_received" | "colour_grading" | "admin_approval" | "designing"
  | "client_review" | "final_approval" | "printing" | "qc" | "ready_for_delivery" | "delivered";

export type Tone = "blue" | "orange" | "pink" | "violet" | "green" | "teal" | "amber" | "red" | "slate" | "indigo";

// SRS §5.1 route: Reception → Colour Grading → Admin Approval → Designing → Admin Design Review →
// Client Review → Final Approval → Printing → QC → Delivery → Closure
export const STAGES: { key: StageKey; label: string; tone: Tone }[] = [
  { key: "new_order", label: "New Order", tone: "blue" },
  { key: "files_received", label: "Files Received", tone: "blue" },
  { key: "colour_grading", label: "Colour Grading", tone: "violet" },
  { key: "admin_approval", label: "Admin Approval", tone: "green" },
  { key: "designing", label: "Designing", tone: "pink" },
  { key: "client_review", label: "Client Review", tone: "amber" },
  { key: "final_approval", label: "Final Approval", tone: "indigo" },
  { key: "printing", label: "Printing", tone: "teal" },
  { key: "qc", label: "QC", tone: "green" },
  { key: "ready_for_delivery", label: "Ready for Delivery", tone: "amber" },
  { key: "delivered", label: "Delivered", tone: "green" },
];
export const stageLabel = (k: StageKey) => STAGES.find((s) => s.key === k)!.label;
export const stageTone = (k: StageKey) => STAGES.find((s) => s.key === k)!.tone;

export type Priority = "Low" | "Normal" | "High" | "Urgent" | "VIP";
export type WorkflowType = "Design + Printing" | "Printing";
export type PayStatus = "Paid" | "Partial" | "Unpaid" | "Overdue";

export interface Staff { id: string; name: string; role: string; dept: string; email: string; mobile: string; status: "Active" | "Inactive"; lastLogin: string }

export const STAFF: Staff[] = [
  { id: "U1", name: "Admin", role: "Super Admin", dept: "Head Office", email: "admin@albumpro.com", mobile: "+91 98765 43210", status: "Active", lastLogin: "2026-10-03T11:20:00" },
  { id: "U2", name: "Ramesh Kumar", role: "Designer", dept: "Designing", email: "ramesh@albumpro.com", mobile: "+91 91234 56789", status: "Active", lastLogin: "2026-10-03T10:15:00" },
  { id: "U3", name: "Manjunath P", role: "Printer", dept: "Printing", email: "manjunath@albumpro.com", mobile: "+91 99876 54321", status: "Active", lastLogin: "2026-10-02T16:45:00" },
  { id: "U4", name: "Karthik V", role: "Colour Grading", dept: "Colour Grading", email: "karthik@albumpro.com", mobile: "+91 98765 67890", status: "Active", lastLogin: "2026-10-03T09:30:00" },
  { id: "U5", name: "Divya S", role: "QC Executive", dept: "Quality Control", email: "divya@albumpro.com", mobile: "+91 90123 45678", status: "Active", lastLogin: "2026-10-02T14:49:00" },
  { id: "U6", name: "Priya N", role: "Reception", dept: "Reception", email: "priya@albumpro.com", mobile: "+91 93456 78901", status: "Active", lastLogin: "2026-10-03T11:05:00" },
  { id: "U7", name: "Suresh B", role: "Accounts", dept: "Accounts", email: "suresh@albumpro.com", mobile: "+91 87654 32109", status: "Active", lastLogin: "2026-10-01T17:40:00" },
  { id: "U8", name: "Ameer Khan", role: "Designer", dept: "Designing", email: "ameer@albumpro.com", mobile: "+91 99887 76655", status: "Active", lastLogin: "2026-10-03T09:12:00" },
  { id: "U9", name: "Neha Reddy", role: "Colour Grading", dept: "Colour Grading", email: "neha@albumpro.com", mobile: "+91 88990 11223", status: "Active", lastLogin: "2026-10-02T15:20:00" },
  { id: "U10", name: "Vikram Jain", role: "Printer", dept: "Printing", email: "vikram@albumpro.com", mobile: "+91 77000 99887", status: "Inactive", lastLogin: "2026-09-28T11:15:00" },
];

export const ASSIGNEES = ["Suresh", "Ramesh", "Divya", "Manoj", "Admin", "Karthik", "Anil", "Priya", "Vikram", "Nandini", "Aravind"];
export const EVENTS = ["Wedding", "Pre Wedding", "Reception", "Engagement", "Birthday", "Hotel Opening", "Baby Shoot", "Corporate"];
export const ALBUM_SIZES = ["12x36", "12x30", "14x40", "10x30", "12x18", "8x12"];
export const PRIORITIES: Priority[] = ["Low", "Normal", "High", "Urgent", "VIP"];

export interface Customer {
  id: string; name: string; studio: string; mobile: string; email: string; city: string; state: string;
  type: "VIP" | "Regular" | "New"; status: "Active" | "Inactive"; activeOrders: number; lifetime: number;
  lastOrder: string; since: string; dues: number; tags: string[];
}

const customerSeed: [string, string, string, string, Customer["type"], number, number, string][] = [
  ["Rahul Sharma", "Sharma Studio", "Mumbai", "rahul@sharmastudio.in", "VIP", 3, 182500, "2026-10-12"],
  ["Priya Mehta", "Mehta Photography", "Delhi", "priya@mehtaphoto.in", "Regular", 2, 96200, "2026-10-10"],
  ["Suresh Karthik", "Karthik Studio", "Bengaluru", "suresh@karthikstudio.in", "Regular", 1, 48000, "2026-10-08"],
  ["Naveen Reddy", "Naveen Digitals", "Hyderabad", "naveen@naveendigitals.in", "VIP", 4, 210300, "2026-10-05"],
  ["Chidanan da", "Chidanan Studio", "Chennai", "chidananda@studio.in", "Regular", 1, 42600, "2026-10-03"],
  ["Anil Kumar", "Anil Studio", "Pune", "anil@anilstudio.in", "New", 1, 18500, "2026-10-02"],
  ["Divya Ramesh", "Ramesh Photography", "Coimbatore", "divya@rameshphoto.in", "Regular", 2, 74800, "2026-10-01"],
  ["Manoj Verma", "Manoj Digitals", "Lucknow", "manoj@manojdigitals.in", "Regular", 0, 28400, "2026-09-28"],
  ["Karthik Nair", "Nair Studio", "Kochi", "karthik@nairstudio.in", "VIP", 5, 320100, "2026-09-25"],
  ["Sneha Iyer", "Iyer Photography", "Mysuru", "sneha@iyerphoto.in", "Regular", 1, 56700, "2026-09-22"],
];
export const CUSTOMERS: Customer[] = customerSeed.map(([name, studio, city, email, type, activeOrders, lifetime, lastOrder], i) => ({
  id: `IDC${String(1248 - i).padStart(6, "0")}`, name, studio, mobile: `+91 98765 ${43210 + i}`, email, city,
  state: ["Maharashtra", "Delhi", "Karnataka", "Telangana", "Tamil Nadu", "Maharashtra", "Tamil Nadu", "Uttar Pradesh", "Kerala", "Karnataka"][i]!,
  type, status: "Active", activeOrders, lifetime, lastOrder, since: "2024-01-12", dues: [12400, 0, 8200, 0, 0, 5000, 0, 0, 22000, 0][i]!,
  tags: ["Wedding", "Pre Wedding", "Events"],
}));

export interface Order {
  id: string; customer: string; mobile: string; event: string; workflow: WorkflowType; size: string; pages: number;
  stage: StageKey; priority: Priority; pendingAt: string; assignee: string; due: string; pay: PayStatus;
  total: number; paid: number; progress: number;
}

// First 12 mirror the screenshots; the remainder are generated deterministically.
const orderSeed: [string, string, string, WorkflowType, string, StageKey, Priority, string, string, string, PayStatus][] = [
  ["Chidanan da", "98765 43210", "Wedding", "Design + Printing", "12x36", "colour_grading", "Normal", "2026-10-01", "Suresh", "2026-10-10", "Paid"],
  ["Naveen Photography", "99876 54321", "Wedding", "Printing", "12x30", "designing", "High", "2026-10-03", "Ramesh", "2026-10-12", "Partial"],
  ["Freezing Frames", "91234 56789", "Wedding", "Design + Printing", "14x40", "client_review", "Normal", "2026-10-02", "Divya", "2026-10-14", "Unpaid"],
  ["Freezing frames", "90012 34567", "Reception", "Printing", "12x36", "printing", "Normal", "2026-10-03", "Manoj", "2026-10-15", "Paid"],
  ["Photo Corner", "88776 65544", "Hotel Opening", "Design + Printing", "14x40", "final_approval", "High", "2026-10-01", "Admin", "2026-10-10", "Partial"],
  ["Loki", "77665 44332", "Wedding", "Design + Printing", "12x36", "qc", "Normal", "2026-09-29", "Karthik", "2026-10-08", "Paid"],
  ["Chethu", "99887 66554", "Wedding", "Design + Printing", "12x36", "ready_for_delivery", "Low", "2026-09-30", "Anil", "2026-10-05", "Paid"],
  ["Srikanth", "88990 11223", "Pre Wedding", "Printing", "10x30", "files_received", "Normal", "2026-10-02", "Suresh", "2026-10-09", "Unpaid"],
  ["Meera Studio", "99455 66778", "Wedding", "Design + Printing", "12x36", "designing", "High", "2026-10-01", "Priya", "2026-10-11", "Partial"],
  ["Arjun & Meera", "90988 77665", "Wedding", "Printing", "12x30", "printing", "Normal", "2026-10-03", "Vikram", "2026-10-13", "Paid"],
  ["The Wed Co.", "99876 11223", "Reception", "Design + Printing", "14x40", "qc", "Normal", "2026-10-04", "Nandini", "2026-10-16", "Unpaid"],
  ["Moments & More", "91234 99876", "Wedding", "Printing", "12x36", "ready_for_delivery", "Low", "2026-10-03", "Aravind", "2026-10-20", "Paid"],
];
const extraNames = ["Candid Clicks", "Divine Moments", "Wedding Bliss", "Artisan Albums", "Picture Perfect", "Focus Events", "Lightbox Films", "Frame Factory", "Pixel Stories", "Zoom Studio", "Grand Moments", "Snap Studio"];
export const ORDERS: Order[] = Array.from({ length: 72 }, (_, i) => {
  const n = 72 - i;
  const s = i < orderSeed.length ? orderSeed[i]! : null;
  const wf: WorkflowType = s ? s[3] : i % 3 === 0 ? "Printing" : "Design + Printing";
  let stage: StageKey = s ? s[5] : STAGES[(i * 7 + 3) % STAGES.length]!.key;
  // SRS §5.2: Printing Only orders skip grading/design/proofing stages.
  if (wf === "Printing") {
    if (stage === "colour_grading" || stage === "admin_approval") stage = "files_received";
    else if (["designing", "client_review", "final_approval"].includes(stage)) stage = "printing";
  }
  const total = 30000 + ((i * 7919) % 60000);
  const pay: PayStatus = s ? s[10] : (["Paid", "Partial", "Unpaid", "Overdue"] as PayStatus[])[i % 4]!;
  const paid = pay === "Paid" ? total : pay === "Partial" ? Math.round(total * 0.5) : 0;
  const day = String(1 + (i % 9)).padStart(2, "0");
  return {
    id: `IDP${String(n).padStart(5, "0")}`,
    customer: s ? s[0] : extraNames[i % extraNames.length]!,
    mobile: "+91 " + (s ? s[1] : `9${(8000 + i * 37) % 10000} ${String(10000 + i * 211).slice(0, 5)}`),
    event: s ? s[2] : EVENTS[i % EVENTS.length]!,
    workflow: wf, size: s ? s[4] : ALBUM_SIZES[i % ALBUM_SIZES.length]!, pages: [30, 36, 40, 50, 60][i % 5]!,
    stage, priority: s ? s[6] : (["Normal", "High", "Normal", "Low", "Urgent"] as Priority[])[i % 5]!,
    pendingAt: s ? s[7] : `2026-10-${day}`, assignee: s ? s[8] : ASSIGNEES[i % ASSIGNEES.length]!,
    due: s ? s[9] : `2026-10-${String(5 + (i % 20)).padStart(2, "0")}`, pay, total, paid,
    progress: Math.min(100, ((STAGES.findIndex((x) => x.key === stage) + 1) / STAGES.length) * 100 | 0),
  };
});

export const countByStage = (k: StageKey) => ORDERS.filter((o) => o.stage === k).length;
