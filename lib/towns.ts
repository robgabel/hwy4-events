/** Geographic data for the Hwy 4 corridor, ordered west to east (ascending elevation) */

export interface TownInfo {
  name: string;
  elevation: number; // feet
  tagline: string;
  driveFromArnold: string; // approximate drive time from Arnold
}

export const CORRIDOR_TOWNS: TownInfo[] = [
  {
    name: "Angels Camp",
    elevation: 1300,
    tagline: "Gold Rush gateway town",
    driveFromArnold: "25 min down the hill",
  },
  {
    name: "Murphys",
    elevation: 2100,
    tagline: "Wine country in the pines",
    driveFromArnold: "15 min down the hill",
  },
  {
    name: "Avery",
    elevation: 2800,
    tagline: "Quiet stop on the way up",
    driveFromArnold: "5 min",
  },
  {
    name: "White Pines",
    elevation: 3500,
    tagline: "Just below Arnold",
    driveFromArnold: "3 min",
  },
  {
    name: "Arnold",
    elevation: 4000,
    tagline: "Heart of the corridor",
    driveFromArnold: "You're here",
  },
  {
    name: "Dorrington",
    elevation: 4800,
    tagline: "Quiet mountain hamlet",
    driveFromArnold: "10 min up the hill",
  },
  {
    name: "Camp Connell",
    elevation: 5000,
    tagline: "Deep in the pines",
    driveFromArnold: "15 min up the hill",
  },
  {
    name: "Bear Valley",
    elevation: 7000,
    tagline: "Alpine resort at the summit",
    driveFromArnold: "30 min to the top",
  },
];

/** Quick lookup by town name */
export const TOWN_INFO: Record<string, TownInfo> = Object.fromEntries(
  CORRIDOR_TOWNS.map((t) => [t.name, t])
);
