// How a submitter wants to be reached — the pure, network-free core.
//
// The submit form used to require an email and leave the name optional. That
// left two problems: a name-less submission is awkward to reply to, and an
// email-only requirement quietly excludes the corridor organizers who conduct
// all their business by phone (a text to the person running the pancake
// breakfast is often the ONLY way to reach them). So the form now requires a
// name plus exactly one contact method, email or phone, and this module owns
// the validation and normalization for both.
//
// Deliberately US-shaped: this is a nine-town corridor in California, not an
// international product. A stricter parser that rejects a real local number
// would be worse than a loose one, so we accept how people actually type it
// (209-555-1234, (209) 555-1234, 209.555.1234, +1 209 555 1234) and reject
// only what cannot be a US number.

export type ContactMethod = "email" | "phone";

export const CONTACT_METHODS: readonly ContactMethod[] = ["email", "phone"];

export function isContactMethod(v: unknown): v is ContactMethod {
  return typeof v === "string" && (CONTACT_METHODS as readonly string[]).includes(v);
}

// ─── Email ──────────────────────────────────────────────────────────────────

/** The same shape check the route has always applied. Deliberately permissive:
 *  a regex cannot prove an address deliverable, and rejecting a valid oddity is
 *  a lost event. */
export function isValidEmail(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// ─── Phone ──────────────────────────────────────────────────────────────────

/** Digits only, with a leading US country code dropped. Returns null when the
 *  value cannot be a US 10-digit number.
 *
 *  Rejects the two shapes that are almost always a typo rather than a number:
 *  an area code or exchange starting with 0 or 1 (no US number does), and any
 *  length other than 10 (or 11 with a leading 1). */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  if (ten[0] === "0" || ten[0] === "1") return null; // invalid area code
  if (ten[3] === "0" || ten[3] === "1") return null; // invalid exchange
  return ten;
}

/** Display form for the admin card: (209) 555-1234. Input is the 10 digits from
 *  normalizePhone; anything else is returned unchanged rather than mangled. */
export function formatPhone(ten: string): string {
  if (!/^\d{10}$/.test(ten)) return ten;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** `tel:` / `sms:` need E.164 to dial reliably from a desktop handoff. */
export function telHref(ten: string): string {
  return /^\d{10}$/.test(ten) ? `+1${ten}` : ten;
}

// ─── The one decision ───────────────────────────────────────────────────────

export interface ResolvedContact {
  /** Exactly one of these is non-null. */
  email: string | null;
  phone: string | null;
}

export interface ContactError {
  error: string;
}

export function isContactError(r: ResolvedContact | ContactError): r is ContactError {
  return (r as ContactError).error !== undefined;
}

/**
 * Turn the form's (method, value) pair into the two columns we store, or an
 * error message safe to show the submitter.
 *
 * Exactly one column is filled. That is what makes "which way did they ask to
 * be reached" answerable from the row itself with no third column to drift out
 * of sync: a phone number present means they chose phone.
 *
 * An unrecognized method falls back to email rather than erroring on the method
 * itself, because a stale cached form posting a bad value should still be told
 * what is actually wrong with the address it sent.
 */
export function resolveContact(input: {
  method: string | null | undefined;
  value: string | null | undefined;
}): ResolvedContact | ContactError {
  const value = (input.value ?? "").trim();
  const method: ContactMethod = isContactMethod(input.method) ? input.method : "email";

  if (!value) {
    return {
      error:
        method === "phone"
          ? "Please enter a phone number so we can reach you with any questions"
          : "Please enter an email so we can reach you with any questions",
    };
  }

  if (method === "phone") {
    const ten = normalizePhone(value);
    if (!ten) {
      return { error: "Please enter a valid 10-digit phone number" };
    }
    return { email: null, phone: ten };
  }

  if (!isValidEmail(value)) {
    return { error: "Please enter a valid email address" };
  }
  return { email: value, phone: null };
}

/** The column + value a rate limiter should key on for this submission. Keeps
 *  the per-submitter daily cap working when the submitter gave a phone instead
 *  of an email (otherwise a phone-only flood would be uncapped). */
export function rateLimitKey(c: ResolvedContact): { column: string; value: string } {
  return c.phone
    ? { column: "submitter_phone", value: c.phone }
    : { column: "submitter_email", value: c.email ?? "" };
}
