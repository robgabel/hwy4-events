/**
 * The active region's town geography, ordered the way locals describe the
 * place (for the corridor: west to east, ascending elevation).
 *
 * SHIM: the data itself now lives in regions/<slug>/core.ts (region-
 * parameterization, docs/REGIONS.md); this module re-exports the active
 * region's towns so its many importers — app pages, components, and the
 * scripts/ scraper package alike — stay unchanged.
 */

import { REGION } from "./region";
import type { TownInfo } from "../regions/types";

export type { TownInfo } from "../regions/types";

export const CORRIDOR_TOWNS: TownInfo[] = REGION.geo.towns;

/** Quick lookup by town name */
export const TOWN_INFO: Record<string, TownInfo> = Object.fromEntries(
  CORRIDOR_TOWNS.map((t) => [t.name, t])
);

/** Canonical town names. Derived from CORRIDOR_TOWNS — single source of truth. */
export const TOWNS: readonly string[] = CORRIDOR_TOWNS.map((t) => t.name);

/**
 * Address-only town aliases — names that appear in scraped addresses but
 * aren't canonical TOWNS (e.g. Hathaway Pines is treated as Arnold in dedup,
 * but FB events sometimes tag it as a distinct location).
 */
export const TOWN_ADDRESS_ALIASES: readonly string[] =
  REGION.geo.townAddressAliases;
