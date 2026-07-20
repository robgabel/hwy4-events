// Core-layer region registry + active-region resolution.
//
// All Rob-operated regions live in this repo; the env var (see resolve.ts)
// picks which one a deployment serves, defaulting to Calaveras so the live
// site needs no env change. This module is CLIENT-SAFE: it may be imported
// from client components and the edge runtime, so it must only ever pull the
// core layer (regions/<slug>/core.ts) — the ops layer has its own registry in
// regions/ops.ts.

import type { RegionCore } from "./types";
import { resolveRegionSlug } from "./resolve";
import { CALAVERAS_CORE } from "./calaveras/core";

export const REGIONS: Readonly<Record<string, RegionCore>> = {
  calaveras: CALAVERAS_CORE,
};

/** Look up a region or fail loudly (at build/boot, never mid-request). */
export function regionForSlug(slug: string): RegionCore {
  const region = REGIONS[slug];
  if (!region) {
    throw new Error(
      `Unknown region "${slug}" — known regions: ${Object.keys(REGIONS).join(
        ", "
      )}. Set NEXT_PUBLIC_REGION (app) / REGION (scripts) to a known slug, or leave unset for the default.`
    );
  }
  return region;
}

export const ACTIVE_SLUG: string = resolveRegionSlug();
export const REGION: RegionCore = regionForSlug(ACTIVE_SLUG);
