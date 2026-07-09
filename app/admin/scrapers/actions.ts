"use server";

import { revalidatePath } from "next/cache";
import { SITE_URL } from "@/lib/constants";
import { failRedirect, flashRedirect } from "@/lib/admin/flash";

// "Run now" for the weekly scraper-health memo. Calls the same CRON_SECRET-gated
// route the Monday cron hits, so there is one generation path, not two. It only
// regenerates the narrative read; the underlying scrape_runs rows come solely
// from scripts/scrape.ts (daily GitHub Action), not from this button.
export async function runScraperHealthMemo() {
  const dest = "/admin/scrapers";
  const secret = process.env.CRON_SECRET;
  if (!secret) failRedirect(dest, "CRON_SECRET is not set; cannot run by hand.");

  let ok = false;
  let message = "";
  try {
    const res = await fetch(`${SITE_URL}/api/agent/scraper-health-memo`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    ok = res.ok;
    if (!ok) message = `Run failed (${res.status}). Check the logs.`;
  } catch (err) {
    message = `Run failed: ${err instanceof Error ? err.message : "network error"}`;
  }

  if (!ok) failRedirect(dest, message);

  revalidatePath("/admin/scrapers");
  flashRedirect(dest, "Scraper-health memo generated.");
}
