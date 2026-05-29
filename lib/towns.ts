/** Geographic data for the Hwy 4 corridor, ordered west to east (ascending elevation) */

export interface TownInfo {
  name: string;
  elevation: number; // feet
  tagline: string;
  lat: number;
  lng: number;
  /**
   * Default street address used when an event has no specific address.
   * Drives the map popup, directions URL, and structured data so the map
   * pin is useful rather than centered on a town centroid with no signal.
   * Optional — only set for towns where there's a sensible town-square anchor.
   */
  defaultAddress?: string;
  /**
   * Default zoom for the town's static map thumbnail and the interactive map's
   * town-centroid fallback. Defaults to 15 (neighborhood) for towns with a real
   * downtown; remote alpine hamlets whose centroid sits in forest use a wider
   * zoom (13) so there's road/context instead of a blank frame. The interactive
   * map still zooms to 15 once it geocodes an actual venue.
   */
  mapZoom?: number;
}

export const CORRIDOR_TOWNS: TownInfo[] = [
  {
    name: "Copperopolis",
    elevation: 850,
    tagline: "Copper country at the base",
    lat: 37.9810,
    lng: -120.6380,
  },
  {
    name: "Angels Camp",
    elevation: 1300,
    tagline: "Gold Rush gateway town",
    lat: 38.0685,
    lng: -120.5396,
  },
  {
    name: "Murphys",
    elevation: 2100,
    tagline: "Wine country in the pines",
    lat: 38.1372,
    lng: -120.4610,
  },
  {
    name: "Avery",
    elevation: 2800,
    tagline: "Quiet stop on the way up",
    lat: 38.1860,
    lng: -120.3870,
    mapZoom: 13,
  },
  {
    name: "White Pines",
    elevation: 3500,
    tagline: "Just below Arnold",
    lat: 38.1970,
    lng: -120.3590,
  },
  {
    name: "Arnold",
    elevation: 4000,
    tagline: "Heart of the corridor",
    lat: 38.2144,
    lng: -120.3510,
    defaultAddress: "961 Highway 4, Arnold CA",
    mapZoom: 13,
  },
  {
    name: "Dorrington",
    elevation: 4800,
    tagline: "Quiet mountain hamlet",
    lat: 38.2280,
    lng: -120.2960,
    mapZoom: 13,
  },
  {
    name: "Camp Connell",
    elevation: 5000,
    tagline: "Deep in the pines",
    lat: 38.2340,
    lng: -120.2750,
    mapZoom: 13,
  },
  {
    name: "Bear Valley",
    elevation: 7000,
    tagline: "Alpine resort at the summit",
    lat: 38.4646,
    lng: -120.0399,
    mapZoom: 14,
  },
];

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
export const TOWN_ADDRESS_ALIASES: readonly string[] = ["Hathaway Pines"];
