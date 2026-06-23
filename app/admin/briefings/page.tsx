import { readFlash } from "@/lib/admin/flash";
import { Banner, adminBtn } from "@/components/admin/ui";
import { PulseTabs } from "@/components/admin/PulseTabs";
import { TodayBriefing } from "./TodayBriefing";
import { GrowthBriefing } from "./GrowthBriefing";
import { runBriefing } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };

// Unified agent-briefings view. The daily chief-of-staff digest and the weekly
// growth memo are both read-only renders of the latest agent_runs row (by
// run_type); this collapses the two former routes (/admin/today, /admin/growth-memo,
// now redirects) into one tabbed page. ?view=growth selects the weekly memo;
// default is the daily digest.
export default async function BriefingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const view = params.view === "growth" ? "growth" : "today";
  const { error, flash } = readFlash(params);

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <PulseTabs
        active={view}
        right={
          <form action={runBriefing}>
            <input type="hidden" name="view" value={view} />
            <button type="submit" style={{ ...adminBtn.secondary, fontSize: 14, padding: "6px 14px" }}>
              Run now
            </button>
          </form>
        }
      />

      {error && <Banner tone="error">{error}</Banner>}
      {flash && <Banner tone="ok">{flash}</Banner>}

      {view === "growth" ? <GrowthBriefing /> : <TodayBriefing />}
    </div>
  );
}
