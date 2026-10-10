// Imported first in main.tsx: restores saved demo data before anything renders.
import { ORDERS, CUSTOMERS } from "./data";
import { persistArray } from "./persist";
import "./audit"; import "./files"; import "./proofs";
persistArray("orders", ORDERS);
persistArray("customers", CUSTOMERS);
