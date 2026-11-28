export const inr = (n: number) => "₹" + n.toLocaleString("en-IN");
export const inrShort = (n: number) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 2)}L` : n >= 1000 ? `₹${Math.round(n / 1000)}K` : `₹${n}`;
import { backendOn } from "./supabase";
/** Demo mode keeps a fixed "today" so the sample data stays meaningful; with the database on, it is the real current time. */
export const TODAY = backendOn ? new Date() : new Date("2026-10-03T10:00:00");
export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
export const isOverdue = (due: string) => new Date(due) < TODAY;

/** Indian mobile: exactly 10 digits, first digit 6-9 (numbers starting 0-5 are not valid). */
/** A mobile number as typed or pasted: digits only, without a +91 / 91 country code or a leading 0 ("+91 98765-43210" → "9876543210"). */
export const cleanMobile = (v: string) => {
  const d = v.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  if (d.length === 13 && d.startsWith("091")) return d.slice(3);
  return d.slice(0, 10);
};
export const mobileError = (v: string) => { const d = v.trim(); return /^[6-9]\d{9}$/.test(d) ? null : d.length < 10 || !/^\d+$/.test(d) ? "Enter a 10-digit mobile number" : "Mobile number must start with 6, 7, 8 or 9"; };
