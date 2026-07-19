// Ops-layer region registry — server/scripts only.
//
// Mirrors regions/index.ts for the RegionOps layer (emails, SEO plumbing,
// schema.org strings, newsletter chrome). Kept as a SEPARATE registry so the
// client-safe core layer never transitively drags ops data into a public
// bundle. Do not import this from a client component; the one blessed
// accessor is lib/region-ops.ts.

import type { RegionOps } from "./types";
import { resolveRegionSlug } from "./resolve";
import { CALAVERAS_OPS } from "./calaveras/ops";

export const REGIONS_OPS: Readonly<Record<string, RegionOps>> = {
  calaveras: CALAVERAS_OPS,
};

export function regionOpsForSlug(slug: string): RegionOps {
  const ops = REGIONS_OPS[slug];
  if (!ops) {
    throw new Error(
      `Unknown region "${slug}" in the ops registry — known: ${Object.keys(
        REGIONS_OPS
      ).join(", ")}. Every region must define BOTH core.ts and ops.ts.`
    );
  }
  return ops;
}

export const REGION_OPS: RegionOps = regionOpsForSlug(resolveRegionSlug());
