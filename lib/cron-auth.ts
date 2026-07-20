import { NextResponse } from "next/server";
import { REGION } from "./region";

// Fail-CLOSED auth for cron / internal API routes.
//
// The old inline pattern `if (cronSecret && authHeader !== ...)` failed OPEN:
// when CRON_SECRET was unset (a misconfigured preview/staging/prod env) the
// `cronSecret &&` short-circuited to false and the route became PUBLIC — exposing
// routes that run paid model calls, mutate/delete events, or send newsletter mail
// (2026-07-02 upstream security review, P1; docs/research/2026-07-02-peter-security-handoff.md).
//
// Here a missing secret is treated as "deny", so a misconfig locks the route
// down instead of opening it. Pure predicate `isCronAuthorized` is locked by
// scripts/test/cron-auth.test.ts.

/** True only when CRON_SECRET is set AND the request carries the matching
 *  bearer token. A missing secret returns false (fail closed). */
export function isCronAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

/** Guard for the top of a route handler: returns a 401 response to return
 *  early, or null when the caller is authorized.
 *
 *    const denied = requireCronAuth(request);
 *    if (denied) return denied;
 */
export function requireCronAuth(request: Request): NextResponse | null {
  return isCronAuthorized(request)
    ? null
    : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Region gate for crons that are specific to one region's data sources.
 *
 * vercel.json is shared across every deployment, so a Calaveras-only cron
 * (the venue-schedule watchers, the BLS/Moose scrapes) would otherwise fire on
 * every region's project. This returns a 200 "skipped" response (NOT a 4xx —
 * Vercel cron must see success and Slack must stay quiet) when the active
 * region isn't in `slugs`, or null (proceed) when it is. On the Calaveras
 * deployment `requireRegion("calaveras")` is a pure no-op, so there is zero
 * behavior change for the live site.
 *
 *    const skip = requireRegion("calaveras");
 *    if (skip) return skip;
 */
export function requireRegion(...slugs: string[]): NextResponse | null {
  if (slugs.includes(REGION.slug)) return null;
  return NextResponse.json({
    ok: true,
    skipped: true,
    reason: `job not enabled for region "${REGION.slug}"`,
  });
}
