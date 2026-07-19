// The engine's one import point for the active region's SERVER-ONLY config
// (emails, SEO plumbing, schema.org strings, newsletter chrome).
//
// NEVER import this from a client component — that would ship ops data in a
// public bundle. Having exactly one accessor module makes that rule cheap to
// review: grep for `region-ops` in any `"use client"` file.
export { REGION_OPS, regionOpsForSlug } from "../regions/ops";
export type { RegionOps } from "../regions/types";
