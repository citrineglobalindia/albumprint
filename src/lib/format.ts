export const inr = (n: number) => "₹" + n.toLocaleString("en-IN");
export const inrShort = (n: number) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 2)}L` : n >= 1000 ? `₹${Math.round(n / 1000)}K` : `₹${n}`;
export const TODAY = new Date("2026-10-03T10:00:00");
export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
export const isOverdue = (due: string) => new Date(due) < TODAY;

/** Indian mobile: exactly 10 digits, first digit 6-9 (numbers starting 0-5 are not valid). */
export const cleanMobile = (v: string) => v.replace(/\D/g, "").slice(0, 10);
export const mobileError = (v: string) => { const d = v.trim(); return /^[6-9]\d{9}$/.test(d) ? null : d.length < 10 || !/^\d+$/.test(d) ? "Enter a 10-digit mobile number" : "Mobile number must start with 6, 7, 8 or 9"; };
