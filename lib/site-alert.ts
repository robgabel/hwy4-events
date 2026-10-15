/**
 * Site-wide safety banner. One place to edit, reschedule, or turn off.
 *
 * Set SITE_ALERT to null to hide it on the next render. It also hides itself
 * outside [startsAt, expiresAt], both inclusive instants. The shipped window
 * ends Sunday Oct 18, 2026 at 11:59:59.999pm Pacific (PDT, UTC-7), so Monday
 * Oct 19 12:00:00am Pacific is the first moment it stays down.
 *
 * Dismiss is per browser and per message text. localStorage stores the
 * message; editing `message` shows the banner again. Do not read cookies or
 * request headers here: that would opt every page out of ISR.
 *
 * Calaveras only. A sibling region must not inherit a Highway 4 PG&E notice.
 */

export type SiteAlertLink = {
  label: string;
  href: string;
};

export type SiteAlert = {
  message: string;
  link: SiteAlertLink;
  /** Inclusive start. ISO-8601 instant (offset included). */
  startsAt: string;
  /** Inclusive end. ISO-8601 instant (offset included). */
  expiresAt: string;
};

export const SITE_ALERT_STORAGE_KEY = "hwy4.siteAlert.dismissed";

export const SITE_ALERT_REGION = "calaveras";

export const SITE_ALERT: SiteAlert | null = {
  message:
    "Power outages along Highway 4: PG&E planned safety shutoffs are affecting parts of Hwy 4 (Arnold to the county line), Hwy 26 and West Point through at least Saturday, Oct 17. Some events may be canceled, moved, or run without power. Check with the organizer before you go.",
  link: {
    label: "PG&E outage status",
    href: "https://www.pge.com/pspsupdates",
  },
  startsAt: "2026-10-15T00:00:00-07:00",
  expiresAt: "2026-10-18T23:59:59.999-07:00",
};

/** True when `now` falls inside the inclusive window. Unparseable dates hide. */
export function isSiteAlertActive(
  alert: Pick<SiteAlert, "startsAt" | "expiresAt"> | null | undefined,
  now: Date,
): boolean {
  if (!alert) return false;
  const start = Date.parse(alert.startsAt);
  const end = Date.parse(alert.expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false;
  const t = now.getTime();
  return t >= start && t <= end;
}

/**
 * Dismiss sticks only while the stored text is the current message.
 * A changed message returns false so the banner comes back.
 */
export function isSiteAlertDismissed(stored: string | null, message: string): boolean {
  return stored === message;
}

/** The alert to render, or null when this region or this instant should not show it. */
export function resolveSiteAlert(
  regionSlug: string,
  alert: SiteAlert | null,
  now: Date,
): SiteAlert | null {
  if (regionSlug !== SITE_ALERT_REGION) return null;
  if (!alert || !isSiteAlertActive(alert, now)) return null;
  return alert;
}

/**
 * Runs from the initial HTML, before paint, so a dismissed or already-expired
 * banner (stale ISR HTML) does not flash. `<` is escaped so a message cannot
 * close the script element.
 */
export function siteAlertGuardScript(alert: SiteAlert): string {
  const payload = JSON.stringify({
    key: SITE_ALERT_STORAGE_KEY,
    message: alert.message,
    expiresMs: Date.parse(alert.expiresAt),
  }).replace(/</g, "\\u003c");
  return `(function(){try{var c=${payload};var hide=Date.now()>c.expiresMs;if(!hide)hide=localStorage.getItem(c.key)===c.message;if(!hide)return;var s=document.createElement("style");s.setAttribute("data-site-alert-guard","");s.textContent="#site-alert{display:none!important}";document.head.appendChild(s);}catch(e){}})();`;
}
