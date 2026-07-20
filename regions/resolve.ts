// Active-region slug resolution. Zero imports — safe in every runtime this
// repo has: client bundles, edge (middleware/OG), node server, and the
// scripts/ tsx runner.

const FALLBACK_REGION = "calaveras";

/**
 * Which region this deployment serves.
 *
 * NEXT_PUBLIC_REGION must appear as this exact static member expression so
 * Next's compiler inlines it into client bundles at build time. REGION covers
 * the scripts package and GitHub Actions (no NEXT_PUBLIC_ vars there); in
 * client bundles bare process.env compiles to {}, so it reads undefined
 * safely. Unset everywhere → the default region, which is why the live
 * Calaveras deployment needs no env change at all.
 */
export function resolveRegionSlug(): string {
  return process.env.NEXT_PUBLIC_REGION || process.env.REGION || FALLBACK_REGION;
}
