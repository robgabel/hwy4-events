import Link from "next/link";
import { readFlash } from "@/lib/admin/flash";
import { Banner } from "@/components/admin/ui";
import { TodayBriefing } from "./TodayBriefing";
import { GrowthBriefing } from "./GrowthBriefing";

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
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 24,
          borderBottom: "1px solid #e8e4de",
        }}
      >
        <Tab href="/admin/briefings" label="Today" sub="daily ops" active={view === "today"} />
        <Tab href="/admin/briefings?view=growth" label="Growth memo" sub="weekly" active={view === "growth"} />
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {flash && <Banner tone="ok">{flash}</Banner>}

      {view === "growth" ? <GrowthBriefing /> : <TodayBriefing />}
    </div>
  );
}

function Tab({
  href,
  label,
  sub,
  active,
}: {
  href: string;
  label: string;
  sub: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        padding: "8px 16px 12px",
        marginBottom: -1,
        color: active ? "#2d5016" : "#999",
        fontWeight: active ? 700 : 500,
        fontSize: 16,
        borderBottom: `2px solid ${active ? "#2d5016" : "transparent"}`,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      <span style={{ fontWeight: 400, fontSize: 13, color: "#aaa" }}> · {sub}</span>
    </Link>
  );
}
