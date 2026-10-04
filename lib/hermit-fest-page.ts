// HWY-53. Search Console shows both spellings of this festival on one URL:
// /events/hermitfest-west-music-festival-2026-09-13-bear-valley
// ("hermitfest 2026" converts; "hermit fest 2026" sits at position ~4.3 with
// hundreds of impressions and almost no clicks). The title and H1 on that
// page were the one-word event name, so the spaced query had nothing to match.
//
// This is copy for that page only. Other event pages, including the other
// Hermitfest rows, keep their own name and title. The year-less /hermitfest
// hub is a different URL and is not what that query is ranking.

export const HERMIT_FEST_RANKING_SLUG =
  "hermitfest-west-music-festival-2026-09-13-bear-valley";

export type HermitFestPageSeo = {
  /** Document title, used absolute so the layout template does not append the site name. */
  title: string;
  h1: string;
  /** Plain answer to "When is Hermit Fest 2026?", date and place. */
  whenLine: string;
};

export function hermitFestPageSeo(slug: string): HermitFestPageSeo | null {
  if (slug !== HERMIT_FEST_RANKING_SLUG) return null;
  return {
    title:
      "Hermit Fest 2026 (Hermitfest) - September 12-13, 2026, Highway 4 Corridor",
    h1: "Hermit Fest 2026",
    whenLine:
      "Hermit Fest 2026 is Saturday, September 12 and Sunday, September 13 at Grizzly Ballfield in Bear Valley, CA.",
  };
}
