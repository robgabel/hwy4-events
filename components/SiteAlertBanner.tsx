import SiteAlertBannerClient from "@/components/SiteAlertBannerClient";
import { REGION } from "@/lib/region";
import { resolveSiteAlert, SITE_ALERT, siteAlertGuardScript } from "@/lib/site-alert";

/**
 * Root-layout banner. Date math uses the render clock only: no cookies(),
 * headers(), or noStore(), so public pages keep their ISR windows. Route
 * handlers (OG images, posters) do not render this layout.
 *
 * The guard script is parser-blocking and sits above the banner so a
 * dismissed or expired copy is display:none before first paint. It toggles
 * a style tag React does not own, which avoids a hydration mismatch.
 */
export default function SiteAlertBanner() {
  const alert = resolveSiteAlert(REGION.slug, SITE_ALERT, new Date());
  if (!alert) return null;

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: siteAlertGuardScript(alert) }} />
      <SiteAlertBannerClient alert={alert} />
    </>
  );
}
