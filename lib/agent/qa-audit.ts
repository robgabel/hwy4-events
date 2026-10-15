import type { SupabaseClient } from "@supabase/supabase-js";
import { generateEventSlug } from "../slugs";
import { checkKeyLine, coveredCheckKeys, DeadlineError, githubIssuesClient, hasTimeFor, type FiledIssue, type IssuesClient } from "../github-issues";
import { SITE_NAME } from "../constants";
import { REGION_OPS } from "../region-ops";

// "… | Hwy 4 Events | Hwy 4 Events" — a page baked the brand suffix into its
// own title AND inherited the root layout template. Built from SITE_NAME so
// the check follows the region brand (identical pattern for Calaveras).
const escapedSiteName = SITE_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DOUBLED_BRAND_RE = new RegExp(
  `\\|\\s*${escapedSiteName}\\s*\\|\\s*${escapedSiteName}`,
  "i"
);

// QA agent. A sibling to /api/check-events, but where that audit reports DATA
// issues to Slack, this one HTTP-checks the live SITE for CODE/regression bugs (a
// page erroring, missing JSON-LD, a broken sitemap) and files GitHub issues
// labelled `proposed` (issue #325: GitHub Issues is the only backlog). Advisory
// only: Rob accepts or closes each one.
//
// Deterministic checks (no LLM): cheap, and a hit is an unambiguous "this is broken."
// One issue per check-class, deduped by the `check_key:` line in the issue body, so
// a recurring failure never floods the backlog.

export type QaSeverity = "p0" | "p1" | "p2" | "p3";

export const QA_ISSUE_LABELS = ["bug", "proposed", "qa", "lens:qa-audit"];

export type QaKind = "page" | "event" | "sitemap" | "bot";

// A page target. keyScope makes the dedup key stable: static routes key by path;
// sampled dynamic routes (event/town, whose slugs rotate) key by a class label so
// "event detail pages missing JSON-LD" is ONE ticket, not one per sampled slug.
export type QaTarget = {
  path: string;
  kind: QaKind;
  keyScope: string;
  label: string;
  /** Fetch as this User-Agent instead of the QA agent's own (bot-access checks). */
  userAgent?: string;
};

export type QaFinding = { check: string; severity: QaSeverity; detail: string };

const SEV_LABEL: Record<string, { title: string; severity: QaSeverity }> = {
  status: { title: "returns an error", severity: "p1" },
  malformed: { title: "is malformed", severity: "p1" },
  jsonld: { title: "is missing JSON-LD structured data", severity: "p2" },
  title: { title: "is missing a <title>", severity: "p2" },
  title_doubled_brand: { title: "has a doubled brand suffix in its <title>", severity: "p2" },
  bot_blocked: { title: "is blocked or challenged", severity: "p2" },
};

// HWY-62: AI search and answer-engine crawlers. robots.txt allows `*`, but a
// firewall or bot-protection rule overrides robots.txt silently, so the weekly
// audit fetches a money page as each of these and files a ticket on a block.
// UA strings follow each vendor's published crawler documentation.
export const AI_BOT_USER_AGENTS: { name: string; ua: string }[] = [
  { name: "OAI-SearchBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot" },
  { name: "ChatGPT-User", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot" },
  { name: "PerplexityBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" },
  { name: "Perplexity-User", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)" },
  { name: "Claude-SearchBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)" },
  { name: "Claude-User", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)" },
  { name: "Bingbot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36" },
  { name: "Googlebot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/120.0.0.0 Safari/537.36" },
];

const BOT_PAGE = "/this-weekend";

// The audit sends the crawler's UA from Vercel's IPs, not the crawler's. A
// verified-bot rule can challenge that spoof while letting the real crawler
// through, so a hit means "go look", not "proven blocked". A pass is proof
// that no UA-based rule blocks the crawler.
const BOT_CAVEAT =
  " Check Vercel Firewall logs for this user agent: a verified-bot rule can challenge this spoofed request while still allowing the real crawler";

// Challenge / interstitial markers a bot-protection layer serves with a 200.
const CHALLENGE_RE = /vercel security checkpoint|attention required|just a moment\.\.\.|checking your browser|captcha/i;

// PURE: given a fetched page, what's wrong with it. Locked by scripts/test/qa-audit.test.ts.
export function checkPage(kind: QaKind, status: number, body: string): QaFinding[] {
  if (kind === "bot") {
    // A crawler that gets anything but the real page is blocked, whatever the
    // status: a 403/429 wall, or a 200 challenge interstitial.
    if (status !== 200) {
      return [{ check: "bot_blocked", severity: "p2", detail: `returned HTTP ${status || "connection error"} to this crawler.${BOT_CAVEAT}` }];
    }
    if (CHALLENGE_RE.test(body)) {
      return [{ check: "bot_blocked", severity: "p2", detail: `served a bot challenge page instead of the content.${BOT_CAVEAT}` }];
    }
    if (!/<title[^>]*>\s*[^<\s][\s\S]*?<\/title>/i.test(body)) {
      return [{ check: "bot_blocked", severity: "p2", detail: `returned 200 without the page's HTML (no <title>).${BOT_CAVEAT}` }];
    }
    return [];
  }
  // A non-200 is the whole story — don't also flag missing content on an error page.
  if (status !== 200) {
    return [{ check: "status", severity: "p1", detail: `returned HTTP ${status || "connection error"}` }];
  }
  const findings: QaFinding[] = [];
  if (kind === "sitemap") {
    if (!/<(urlset|sitemapindex)\b/i.test(body)) {
      findings.push({ check: "malformed", severity: "p1", detail: "response is not a valid sitemap XML document" });
    }
    return findings;
  }
  // page + event both need a non-empty <title>. Inspect the tag's actual content
  // (a naive "\S after <title>" would treat "<title></title>" as non-empty, since
  // the "<" of the closing tag is non-whitespace).
  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch || titleMatch[1].trim().length === 0) {
    findings.push({ check: "title", severity: "p2", detail: "no non-empty <title> element in the HTML" });
  } else if (DOUBLED_BRAND_RE.test(titleMatch[1])) {
    // A page baked the brand suffix into its own title AND inherited the root
    // layout's `%s | Hwy 4 Events` template (2026-07-16 QA: every town page
    // rendered "… | Hwy 4 Events | Hwy 4 Events"). Standing check so the next
    // page class that does this gets a ticket instead of shipping doubled.
    findings.push({
      check: "title_doubled_brand",
      severity: "p2",
      detail: `title renders the brand suffix twice: "${titleMatch[1].trim().slice(0, 120)}"`,
    });
  }
  // event detail pages must carry JSON-LD (the AEO/structured-data spine).
  if (kind === "event" && !body.includes("application/ld+json")) {
    findings.push({ check: "jsonld", severity: "p2", detail: "no application/ld+json script on the event page" });
  }
  return findings;
}

export function checkKey(check: string, keyScope: string): string {
  return `qa:${check}:${keyScope}`;
}

function ticketTitle(check: string, label: string): string {
  const t = SEV_LABEL[check]?.title ?? `has a ${check} issue`;
  return `QA: ${label} ${t}`;
}

async function fetchTarget(
  base: string,
  path: string,
  userAgent?: string
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${base}${path}`, {
      signal: controller.signal,
      headers: { "User-Agent": userAgent ?? `${REGION_OPS.userAgents.qaName}/1.0` },
      cache: "no-store",
    });
    const body = await res.text();
    return { status: res.status, body };
  } catch {
    return { status: 0, body: "" }; // network error / timeout → treated as a status finding
  } finally {
    clearTimeout(timer);
  }
}

// The static route set: the money pages + the funnel + the sitemaps.
const STATIC_TARGETS: QaTarget[] = [
  { path: "/", kind: "page", keyScope: "/", label: "The homepage" },
  { path: "/this-week", kind: "page", keyScope: "/this-week", label: "The /this-week page" },
  { path: "/this-weekend", kind: "page", keyScope: "/this-weekend", label: "The /this-weekend page" },
  { path: "/this-month", kind: "page", keyScope: "/this-month", label: "The /this-month page" },
  { path: "/things-to-do", kind: "page", keyScope: "/things-to-do", label: "The /things-to-do page" },
  { path: "/free", kind: "page", keyScope: "/free", label: "The /free page" },
  { path: "/date-night", kind: "page", keyScope: "/date-night", label: "The /date-night page" },
  { path: "/live-music", kind: "page", keyScope: "/live-music", label: "The /live-music page" },
  { path: "/about", kind: "page", keyScope: "/about", label: "The /about page" },
  { path: "/submit", kind: "page", keyScope: "/submit", label: "The /submit page" },
  { path: "/hosts", kind: "page", keyScope: "/hosts", label: "The /hosts page" },
  { path: "/sitemap.xml", kind: "sitemap", keyScope: "/sitemap.xml", label: "The sitemap index" },
  { path: "/sitemap-core.xml", kind: "sitemap", keyScope: "/sitemap-core.xml", label: "The core sitemap" },
  { path: "/sitemap-events.xml", kind: "sitemap", keyScope: "/sitemap-events.xml", label: "The events sitemap" },
  // One ticket per crawler, so "Bingbot is challenged" and "PerplexityBot is
  // challenged" are separate, actionable findings.
  ...AI_BOT_USER_AGENTS.map(
    (b): QaTarget => ({
      path: BOT_PAGE,
      kind: "bot",
      keyScope: `bot:${b.name}`,
      label: `The ${BOT_PAGE} page as ${b.name}`,
      userAgent: b.ua,
    })
  ),
];

export type QaAuditResult = {
  checked: number;
  findings: number;
  filed: number;
  skipped: number;
  filed_issues: FiledIssue[];
  /** The first reason findings didn't reach GitHub this run (token missing, list/create failed, labels dropped, deadline). */
  filing_error: string | null;
  /** Every distinct filing failure in the run, so one can't mask another. */
  filing_errors: string[];
  /** Titles of findings that were not filed because of filing_error. */
  unfiled_titles: string[];
};

// PURE: the issue body for one aggregated finding. The check_key line is what the
// next run matches on, so it stays the last line. Locked by scripts/test/qa-audit.test.ts.
export function qaIssueBody(a: { key: string; check: string; severity: QaSeverity; detail: string; examples: string[] }): string {
  const examples = a.examples.slice(0, 5).join(", ");
  const fix =
    a.check === "bot_blocked"
      ? "Reproduce in the Vercel Firewall logs for that crawler, then remove or relax the rule that blocks it."
      : "Reproduce by loading the URL(s) above and confirming, then fix the underlying page or route.";
  return [
    `**Suggested priority: ${a.severity}.** Filed automatically by the weekly QA audit (\`/api/agent/qa-audit\`).`,
    "",
    "## Problem",
    `The QA audit found a problem on the live site: ${a.detail}.`,
    "",
    `Affected: ${examples}.`,
    "",
    "## Proposed fix",
    fix,
    "",
    "If this is a false alarm or already fixed, close it as not planned. The audit will not refile it for 30 days.",
    "",
    checkKeyLine(a.key),
  ].join("\n");
}

// Build the dynamic sample: a few live event-detail pages + a few town pages. Slugs
// rotate, so these key by class (event-detail / town-page), not by slug.
async function dynamicTargets(supabase: SupabaseClient): Promise<QaTarget[]> {
  const today = new Date().toISOString().split("T")[0];
  const targets: QaTarget[] = [];

  // Event-detail URLs are COMPUTED from name+date+town (there is no `slug` column —
  // the app builds them via generateEventSlug, mirrored here). Exclude is_routine
  // rows: those 404 on the detail page by design, so sampling one would be a false bug.
  const { data: events, error } = await supabase
    .from("hwy4_events")
    .select("name, date, town")
    .gte("date", today)
    .eq("visibility", "public")
    .neq("status", "cancelled")
    .neq("is_routine", true)
    .order("date", { ascending: true })
    .limit(3);
  if (error) console.error("[qa-audit] event sample query failed:", error.message);
  for (const e of (events ?? []) as { name: string; date: string; town: string }[]) {
    targets.push({
      path: `/events/${generateEventSlug(e.name, e.date, e.town)}`,
      kind: "event",
      keyScope: "event-detail",
      label: "Event detail pages",
    });
  }

  // A small, stable set of town pages (town slugs don't rotate like event slugs).
  for (const slug of REGION_OPS.qaAudit.townSlugSample) {
    targets.push({ path: `/towns/${slug}`, kind: "page", keyScope: "town-page", label: "Town pages" });
  }
  return targets;
}

export async function runQaAudit(
  supabase: SupabaseClient,
  baseUrl: string,
  issues: IssuesClient | null = githubIssuesClient(),
  /** Epoch ms by which filing must stop, so the route can still write the Inbox alert. */
  deadline?: number
): Promise<QaAuditResult> {
  const targets = [...STATIC_TARGETS, ...(await dynamicTargets(supabase))];

  // Fetch + evaluate all targets in parallel.
  const perTarget = await Promise.all(
    targets.map(async (t) => {
      const res = await fetchTarget(baseUrl, t.path, t.userAgent);
      return { target: t, findings: checkPage(t.kind, res.status, res.body), status: res.status };
    })
  );

  // If the page itself is down for the QA agent's own UA, every crawler fetch
  // fails too; that is one outage (already a status ticket), not eight firewall
  // problems, so the bot findings are dropped for this run.
  const botPageDown = perTarget.some(
    (r) => r.target.kind === "page" && r.target.path === BOT_PAGE && r.findings.length > 0
  );
  if (botPageDown) {
    for (const r of perTarget) if (r.target.kind === "bot") r.findings = [];
  }

  // Collapse to one entry per check_key, collecting example paths (dedup a class
  // that fails on multiple sampled slugs into a single ticket).
  const byKey = new Map<string, QaAgg>();
  for (const { target, findings } of perTarget) {
    for (const f of findings) {
      const key = checkKey(f.check, target.keyScope);
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.examples.includes(target.path)) existing.examples.push(target.path);
      } else {
        byKey.set(key, {
          key,
          check: f.check,
          severity: f.severity,
          title: ticketTitle(f.check, target.label),
          examples: [target.path],
          detail: f.detail,
        });
      }
    }
  }
  const aggs = [...byKey.values()];

  return { checked: targets.length, findings: aggs.length, ...(await fileQaFindings(issues, aggs, deadline)) };
}

export type QaAgg = { key: string; check: string; severity: QaSeverity; title: string; examples: string[]; detail: string };

export type QaFilingResult = Omit<QaAuditResult, "checked" | "findings">;

// File one issue per aggregated finding. Split out of runQaAudit so the error
// paths (no token, list failed, create failed, labels dropped) can be driven
// with a fake client. Locked by scripts/test/qa-audit.test.ts.
export async function fileQaFindings(
  issues: IssuesClient | null,
  aggs: QaAgg[],
  deadline?: number
): Promise<QaFilingResult> {
  const notFiled = (filing_error: string): QaFilingResult => ({
    filed: 0,
    skipped: aggs.length,
    filed_issues: [],
    filing_error,
    filing_errors: [filing_error],
    unfiled_titles: aggs.map((a) => a.title),
  });
  if (aggs.length === 0) {
    return { filed: 0, skipped: 0, filed_issues: [], filing_error: null, filing_errors: [], unfiled_titles: [] };
  }
  if (!issues) {
    console.error("[qa-audit] GITHUB_ISSUES_TOKEN_MISSING: findings not filed");
    return notFiled("GITHUB_ISSUES_TOKEN_MISSING");
  }

  // Dedup against issues already open, or declined (not planned / duplicate) in
  // the last 30 days. An issue closed as completed does not count, so a fixed bug
  // that regresses is filed again. Fail closed: if the list can't be read, file
  // nothing rather than risk a duplicate.
  let covered: Set<string>;
  try {
    covered = coveredCheckKeys(await issues.listRecent(new Date(), deadline));
  } catch (err) {
    console.error("[qa-audit] listing issues failed:", err);
    return notFiled(err instanceof DeadlineError ? "deadline_exceeded" : "list_failed");
  }

  const filed: FiledIssue[] = [];
  const unfiled: string[] = [];
  let skipped = 0;
  const filingErrors = new Set<string>();
  for (const a of aggs) {
    if (covered.has(a.key)) {
      skipped++;
      continue;
    }
    if (!hasTimeFor(deadline)) {
      filingErrors.add("deadline_exceeded");
      unfiled.push(a.title);
      skipped++;
      continue;
    }
    try {
      const issue = await issues.create({ title: a.title, body: qaIssueBody(a), labels: QA_ISSUE_LABELS });
      filed.push(issue);
      covered.add(a.key);
      if (!issue.gated) {
        console.error(`[qa-audit] #${issue.number} was filed without the proposed label`);
        filingErrors.add("labels_dropped");
      }
    } catch (err) {
      console.error("[qa-audit] create issue failed:", err);
      filingErrors.add("create_failed");
      unfiled.push(a.title);
      skipped++;
    }
  }

  const errorList = [...filingErrors];
  return {
    filed: filed.length,
    skipped,
    filed_issues: filed,
    filing_error: errorList[0] ?? null,
    filing_errors: errorList,
    unfiled_titles: unfiled,
  };
}
