export const inr = (n: number) => "₹" + n.toLocaleString("en-IN");
export const inrShort = (n: number) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 2)}L` : n >= 1000 ? `₹${Math.round(n / 1000)}K` : `₹${n}`;
export const TODAY = new Date("2026-10-03T10:00:00");
export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
export const isOverdue = (due: string) => new Date(due) < TODAY;
