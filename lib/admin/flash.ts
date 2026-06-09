import { redirect } from "next/navigation";

export type SearchParams = { [key: string]: string | string[] | undefined };

// One flash convention for every admin action and page. Failures redirect with
// ?error=, successes with ?flash=. Replaces the old grab-bag of one-off params
// (?added=1, ?updated=1, ?deleted=1) that each page had to special-case.
export function failRedirect(adminPath: string, message: string): never {
  redirect(`${adminPath}?error=${encodeURIComponent(message)}`);
}

export function flashRedirect(
  adminPath: string,
  message: string,
  extra?: Record<string, string>
): never {
  const params = new URLSearchParams({ flash: message, ...(extra ?? {}) });
  redirect(`${adminPath}?${params.toString()}`);
}

// Trimmed string value of a submitted form field.
export function field(formData: FormData, name: string): string {
  return ((formData.get(name) as string | null) ?? "").trim();
}

// Trimmed field that bounces to ?error= when blank. Returns the value otherwise.
export function requireField(
  formData: FormData,
  name: string,
  adminPath: string,
  label = name
): string {
  const value = field(formData, name);
  if (!value) failRedirect(adminPath, `Missing ${label}.`);
  return value;
}

// Resolve an optional `returnTo` form field to an internal admin path, so an
// action invoked from one surface (e.g. the briefings action rail) can send the
// human back where they were instead of the action's own page. Only ever honors
// an internal /admin/ path — never an external/open redirect.
export function safeReturnTo(formData: FormData, fallback: string): string {
  const rt = field(formData, "returnTo");
  if (rt.startsWith("/admin/") && !rt.includes("//")) return rt;
  return fallback;
}

// Read the standard banner messages off a page's resolved searchParams.
export function readFlash(params: SearchParams): {
  error: string | null;
  flash: string | null;
} {
  return {
    error: typeof params.error === "string" ? params.error : null,
    flash: typeof params.flash === "string" ? params.flash : null,
  };
}
