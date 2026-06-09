import type { SupabaseClient } from "@supabase/supabase-js";

// Single source of truth for newsletter signup trends (PRD-growth-agent.md R1a).
// Derives the daily series + running total + composition straight from
// newsletter_subscribers (created_at / confirmed_at / unsubscribed_at /
// visitor_class / signup_source) — no snapshot table, since the raw rows carry
// the full history. Cheap into the low thousands. Reused by the Growth tab and
// the growth-memo signal pack so the two can never disagree.

export type NewsletterDay = {
  date: string; // YYYY-MM-DD (civil date in the requested tz; default Pacific)
  signups: number; // confirmed signups that day
  unsubs: number; // unsubscribes that day
  net: number; // signups - unsubs
  cumulative_active: number; // confirmed-and-not-unsubscribed as of end of day
};

export type NewsletterStats = {
  total_active: number;
  net_7d: number;
  net_30d: number;
  confirm_rate_30d: number | null; // confirmed / created over last 30d (the opt-in leak)
  pending_unconfirmed: number; // signed up in 30d, never confirmed, not unsubscribed
  by_class: Record<"local" | "visitor" | "unknown", number>; // active list composition
  by_source: Record<string, number>; // active subs by signup placement (R1b)
  days: NewsletterDay[]; // chronological, oldest -> newest, length = `days` arg
};

type SubRow = {
  created_at: string | null;
  confirmed: boolean | null;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  visitor_class: string | null;
  signup_source: string | null;
};

const DEFAULT_TZ = "America/Los_Angeles";

/** Civil date (YYYY-MM-DD) for an ISO timestamp in the given IANA tz. Signups are
 *  bucketed by the local day they happened. Default Pacific (matches the rest of
 *  the site's date math); pass "UTC" to align with Cloudflare's UTC-day analytics. */
function civilDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso)); // en-CA yields YYYY-MM-DD
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

export async function getNewsletterStats(
  supabase: SupabaseClient,
  days = 60,
  tz: string = DEFAULT_TZ
): Promise<NewsletterStats> {
  // Pull the whole table once and derive everything. RLS-bypassing service role.
  const { data } = await supabase
    .from("newsletter_subscribers")
    .select("created_at, confirmed, confirmed_at, unsubscribed_at, visitor_class, signup_source")
    .limit(100000);
  const rows = (data ?? []) as SubRow[];

  const today = civilDay(new Date().toISOString(), tz);
  const windowStart = addDays(today, -(days - 1));
  const d7 = addDays(today, -6);
  const d30 = addDays(today, -29);

  // Build the day buckets.
  const byDay = new Map<string, { signups: number; unsubs: number }>();
  for (let i = 0; i < days; i++) {
    byDay.set(addDays(windowStart, i), { signups: 0, unsubs: 0 });
  }

  const by_class: NewsletterStats["by_class"] = { local: 0, visitor: 0, unknown: 0 };
  const by_source: Record<string, number> = {};
  let total_active = 0;
  let net_7d = 0;
  let net_30d = 0;
  let created_30d = 0;
  let confirmed_of_created_30d = 0;
  let pending_unconfirmed = 0;

  for (const r of rows) {
    const active = !!r.confirmed && !r.unsubscribed_at;
    if (active) {
      total_active++;
      const cls = (r.visitor_class as keyof NewsletterStats["by_class"]) || "unknown";
      by_class[cls in by_class ? cls : "unknown"]++;
      const src = r.signup_source || "(unknown)";
      by_source[src] = (by_source[src] ?? 0) + 1;
    }

    // confirmed signup day
    if (r.confirmed && r.confirmed_at) {
      const day = civilDay(r.confirmed_at, tz);
      const b = byDay.get(day);
      if (b) b.signups++;
      if (day >= d7) net_7d++;
      if (day >= d30) net_30d++;
    }
    // unsubscribe day
    if (r.unsubscribed_at) {
      const day = civilDay(r.unsubscribed_at, tz);
      const b = byDay.get(day);
      if (b) b.unsubs++;
      if (day >= d7) net_7d--;
      if (day >= d30) net_30d--;
    }
    // confirm-rate leak over last 30d of *created* rows
    if (r.created_at) {
      const cday = civilDay(r.created_at, tz);
      if (cday >= d30) {
        created_30d++;
        if (r.confirmed) confirmed_of_created_30d++;
        if (!r.confirmed && !r.unsubscribed_at) pending_unconfirmed++;
      }
    }
  }

  // Running cumulative active across the window. Start from the active count as
  // of the day BEFORE the window, then walk forward applying each day's net.
  const netBeforeWindow = rows.reduce((acc, r) => {
    let n = acc;
    if (r.confirmed && r.confirmed_at && civilDay(r.confirmed_at, tz) < windowStart) n++;
    if (r.unsubscribed_at && civilDay(r.unsubscribed_at, tz) < windowStart) n--;
    return n;
  }, 0);

  let running = netBeforeWindow;
  const daysOut: NewsletterDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(windowStart, i);
    const b = byDay.get(date)!;
    running += b.signups - b.unsubs;
    daysOut.push({
      date,
      signups: b.signups,
      unsubs: b.unsubs,
      net: b.signups - b.unsubs,
      cumulative_active: running,
    });
  }

  return {
    total_active,
    net_7d,
    net_30d,
    confirm_rate_30d: created_30d > 0 ? confirmed_of_created_30d / created_30d : null,
    pending_unconfirmed,
    by_class,
    by_source,
    days: daysOut,
  };
}
