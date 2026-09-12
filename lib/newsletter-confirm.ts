// Double-opt-in confirm funnel: signup copy, confirm + reminder emails,
// and the confirm-landing pages. Pure so the scripts test runner can lock
// it without the Next app. Tokens do not expire; a reminder reuses the
// same confirm URL. The app never auto-sends a reminder — Rob opens a
// Gmail draft from /admin/newsletter.

import { SITE_NAME, SITE_URL } from "./constants";
import { REGION } from "./region";

export const CONFIRM_EMAIL_SUBJECT = "Confirm you're on the Thursday list";
export const REMINDER_EMAIL_SUBJECT = "Still want the Thursday list?";

/** Hours a signup must sit unconfirmed before it is listed for a human reminder. */
export const REMINDER_MIN_AGE_HOURS = 24;

/** Hard cap on the admin reminder list. The full pending count is shown beside it. */
export const REMINDER_LIST_CAP = 100;

export const TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SubscribeOutcome = "check_email" | "already_subscribed";

export function subscribeResponse(outcome: SubscribeOutcome): {
  ok: true;
  outcome: SubscribeOutcome;
  message: string;
} {
  if (outcome === "already_subscribed") {
    return {
      ok: true,
      outcome,
      message: "You're already on the Thursday list.",
    };
  }
  return {
    ok: true,
    outcome,
    message: "Confirmation email sent",
  };
}

export type CheckEmailCopy = {
  heading: string;
  fromLabel: string;
  subject: string;
  steps: string[];
  note: string;
};

export function checkEmailCopy(): CheckEmailCopy {
  return {
    heading: "Check your email",
    fromLabel: SITE_NAME,
    subject: CONFIRM_EMAIL_SUBJECT,
    steps: [
      `Open the message from ${SITE_NAME}.`,
      `Subject: ${CONFIRM_EMAIL_SUBJECT}.`,
      "Tap the confirm button. The next page asks once more, so a mail scanner cannot sign you up by itself.",
    ],
    note: "It sometimes lands in Promotions or Spam. No Thursday email goes out until you confirm.",
  };
}

export function alreadySubscribedCopy(): { heading: string; note: string } {
  return {
    heading: "You're already on the Thursday list",
    note: "Nothing else to do. The next issue lands Thursday morning.",
  };
}

export const SIGNUP_EXPECTATION =
  "We'll email a confirm link. No Thursday email until you tap it.";

export type ConfirmLandingKind =
  | "ask"
  | "confirmed"
  | "already"
  | "invalid"
  | "error";

export type ConfirmLandingCopy = {
  kind: ConfirmLandingKind;
  title: string;
  heading: string;
  body: string;
  buttonLabel?: string;
  finePrint?: string;
  ctaHref?: string;
  ctaLabel?: string;
};

export function confirmLandingCopy(kind: ConfirmLandingKind): ConfirmLandingCopy {
  switch (kind) {
    case "ask":
      return {
        kind,
        title: `Confirm subscription · ${SITE_NAME}`,
        heading: SITE_NAME,
        body: "One more tap and you're on the Thursday list. Mail scanners prefetch links, so this extra click is how we know it's you.",
        buttonLabel: "Yes, add me",
        finePrint: "Didn't sign up? Close this page.",
      };
    case "confirmed":
      return {
        kind,
        title: `You're on the list · ${SITE_NAME}`,
        heading: "You're on the Thursday list",
        body: "First issue lands Thursday morning. Until then, this weekend's lineup is up on the site.",
        ctaHref: `${SITE_URL}/this-weekend`,
        ctaLabel: "See this weekend",
      };
    case "already":
      return {
        kind,
        title: `Already confirmed · ${SITE_NAME}`,
        heading: "You're already on the list",
        body: "Nothing else to do. Thursday's email will keep coming.",
        ctaHref: `${SITE_URL}/this-weekend`,
        ctaLabel: "See this weekend",
      };
    case "invalid":
      return {
        kind,
        title: `Confirm link isn't valid · ${SITE_NAME}`,
        heading: "This confirm link isn't valid",
        body: "It may be a broken copy, or this address was never signed up. You can try again from the site.",
        ctaHref: SITE_URL,
        ctaLabel: `Back to ${REGION.siteRef}`,
      };
    case "error":
      return {
        kind,
        title: `Something went wrong · ${SITE_NAME}`,
        heading: "Something went wrong",
        body: "The confirm didn't go through. Try the link in your email again in a minute.",
        ctaHref: SITE_URL,
        ctaLabel: `Back to ${REGION.siteRef}`,
      };
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderConfirmLandingHtml(
  kind: ConfirmLandingKind,
  opts: { token?: string } = {}
): string {
  const copy = confirmLandingCopy(kind);
  const token = opts.token && TOKEN_RE.test(opts.token) ? opts.token : "";

  let action = "";
  if (kind === "ask" && token && copy.buttonLabel) {
    action = `<form method="POST" action="/api/newsletter/confirm">
      <input type="hidden" name="token" value="${token}">
      <button type="submit" style="display: inline-block; background: #2d5016; color: white; padding: 14px 28px; border-radius: 8px; border: none; font-size: 16px; font-weight: 600; cursor: pointer;">
        ${escapeHtml(copy.buttonLabel)}
      </button>
    </form>`;
  } else if (copy.ctaHref && copy.ctaLabel) {
    action = `<a href="${escapeHtml(copy.ctaHref)}" style="display: inline-block; background: #2d5016; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">${escapeHtml(copy.ctaLabel)}</a>`;
  }

  const fine = copy.finePrint
    ? `<p style="color: #888; font-size: 13px; margin-top: 24px;">${escapeHtml(copy.finePrint)}</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(copy.title)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #faf9f6;">
  <div style="text-align: center; max-width: 420px; padding: 32px;">
    <h1 style="color: #2d5016; font-size: 22px; margin: 0 0 12px;">${escapeHtml(copy.heading)}</h1>
    <p style="color: #444; line-height: 1.6; margin: 0 0 24px;">${escapeHtml(copy.body)}</p>
    ${action}
    ${fine}
  </div>
</body>
</html>`;
}

export function buildConfirmationEmailHtml(confirmUrl: string): {
  subject: string;
  html: string;
} {
  const href = escapeHtml(confirmUrl);
  return {
    subject: CONFIRM_EMAIL_SUBJECT,
    html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
      <div style="background: #1B3A2D; border-radius: 12px; padding: 18px 16px; text-align: center; margin-bottom: 20px;">
        <p style="color: #ffffff; font-size: 20px; font-weight: 700; margin: 0;">${escapeHtml(SITE_NAME)}</p>
      </div>
      <h2 style="color: #2d5016; margin: 0 0 16px; font-size: 22px;">Confirm you're on the Thursday list</h2>
      <p style="color: #444; line-height: 1.6; margin: 0 0 12px;">
        You asked for the weekly ${escapeHtml(SITE_NAME)} email. Tap the button below, then tap once more on the next page. Mail scanners prefetch links, so that extra tap is how we know it's you.
      </p>
      <p style="color: #444; line-height: 1.6; margin: 0 0 12px;">
        Thursday morning you'll get what's on this weekend and next week along the 4. Nothing else.
      </p>
      <a href="${href}" style="display: inline-block; background: #2d5016; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 24px 0;">
        Confirm my email
      </a>
      <p style="color: #888; font-size: 13px; margin-top: 24px;">
        If you didn't sign up, ignore this. We won't add you.
      </p>
    </div>
  `,
  };
}

export function buildConfirmReminderDraft(confirmUrl: string): {
  subject: string;
  body: string;
} {
  return {
    subject: REMINDER_EMAIL_SUBJECT,
    body: `You signed up for the ${SITE_NAME} Thursday email (what's on this weekend along the 4) but we never got the confirm tap.

If you still want it, open this link and tap the button on the next page:

${confirmUrl}

If this wasn't you, ignore this note.`,
  };
}

export function gmailComposeUrl(to: string, subject: string, body: string): string {
  const enc = encodeURIComponent;
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`;
}

export function confirmUrlForToken(token: string): string {
  return `${SITE_URL}/api/newsletter/confirm?token=${token}`;
}

export type PendingUnconfirmed = {
  email: string;
  unsubscribe_token: string;
  created_at: string;
  last_confirmation_sent_at: string | null;
  unsubscribed_at?: string | null;
  confirmed?: boolean | null;
};

export function isPendingUnconfirmed(row: {
  email?: string | null;
  unsubscribe_token?: string | null;
  confirmed?: boolean | null;
  unsubscribed_at?: string | null;
}): boolean {
  return (
    typeof row.email === "string" &&
    row.email.includes("@") &&
    typeof row.unsubscribe_token === "string" &&
    TOKEN_RE.test(row.unsubscribe_token) &&
    !row.confirmed &&
    !row.unsubscribed_at
  );
}

export function isReminderEligible(
  row: PendingUnconfirmed,
  now: Date = new Date(),
  minAgeHours: number = REMINDER_MIN_AGE_HOURS
): boolean {
  if (!isPendingUnconfirmed(row)) return false;
  const created = Date.parse(row.created_at);
  if (!Number.isFinite(created)) return false;
  return now.getTime() - created >= minAgeHours * 60 * 60 * 1000;
}

export function selectReminderCandidates<T extends PendingUnconfirmed>(
  rows: T[],
  now: Date = new Date(),
  cap: number = REMINDER_LIST_CAP
): T[] {
  return rows
    .filter((r) => isReminderEligible(r, now))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .slice(0, cap);
}
