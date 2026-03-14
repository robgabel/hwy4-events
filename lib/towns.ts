/** Geographic data for the Hwy 4 corridor, ordered west to east (ascending elevation) */

export interface TownInfo {
  name: string;
  elevation: number; // feet
  tagline: string;
  driveFromArnold: string; // approximate drive time from Arnold
  lat: number;
  lng: number;
}

export const CORRIDOR_TOWNS: TownInfo[] = [
  {
    name: "Angels Camp",
    elevation: 1300,
    tagline: "Gold Rush gateway town",
    driveFromArnold: "25 min down the hill",
    lat: 38.0685,
    lng: -120.5396,
  },
  {
    name: "Murphys",
    elevation: 2100,
    tagline: "Wine country in the pines",
    driveFromArnold: "15 min down the hill",
    lat: 38.1372,
    lng: -120.4610,
  },
  {
    name: "Avery",
    elevation: 2800,
    tagline: "Quiet stop on the way up",
    driveFromArnold: "5 min",
    lat: 38.1860,
    lng: -120.3870,
  },
  {
    name: "White Pines",
    elevation: 3500,
    tagline: "Just below Arnold",
    driveFromArnold: "3 min",
    lat: 38.1970,
    lng: -120.3590,
  },
  {
    name: "Arnold",
    elevation: 4000,
    tagline: "Heart of the corridor",
    driveFromArnold: "You're here",
    lat: 38.2144,
    lng: -120.3510,
  },
  {
    name: "Dorrington",
    elevation: 4800,
    tagline: "Quiet mountain hamlet",
    driveFromArnold: "10 min up the hill",
    lat: 38.2280,
    lng: -120.2960,
  },
  {
    name: "Camp Connell",
    elevation: 5000,
    tagline: "Deep in the pines",
    driveFromArnold: "15 min up the hill",
    lat: 38.2340,
    lng: -120.2750,
  },
  {
    name: "Bear Valley",
    elevation: 7000,
    tagline: "Alpine resort at the summit",
    driveFromArnold: "30 min to the top",
    lat: 38.2810,
    lng: -120.0420,
  },
];

/** Quick lookup by town name */
export const TOWN_INFO: Record<string, TownInfo> = Object.fromEntries(
  CORRIDOR_TOWNS.map((t) => [t.name, t])
);
