// The engine's one import point for the active region's CLIENT-SAFE config.
// Relative import (no "@/") so the scripts/ tsx runner resolves it too.
// Server-only values live behind lib/region-ops.ts instead.
export { REGION, ACTIVE_SLUG, regionForSlug } from "../regions/index";
export type { RegionCore, RegionGeo, TownInfo } from "../regions/types";
