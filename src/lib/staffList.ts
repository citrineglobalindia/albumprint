import { ASSIGNEES } from "./data";
import { backendOn } from "./supabase";
import { staffDirectory } from "./db/production";

/** Who an order can be assigned to: the real staff in database mode, the sample names in demo mode. */
export const assignees = (): string[] => (backendOn ? [...new Set(staffDirectory())].sort() : ASSIGNEES);
