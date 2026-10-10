// Importing this module registers every domain's hydrator. Add new domains here.
import "./orders";
export { backendOn, hydrateAll, onDbError, reportDbError } from "./core";
