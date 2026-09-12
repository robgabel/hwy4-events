import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { SITE_URL } from "@/lib/constants";
import { buildWelcomeEmailHtml, newsletterFromHeader } from "@/lib/newsletter";
import {
  TOKEN_RE,
  renderConfirmLandingHtml,
} from "@/lib/newsletter-confirm";

// Scanner-safe double opt-in. Email security scanners (Outlook SafeLinks,
// Mimecast, Gmail) prefetch every GET in a message, so a GET that flips
// confirmed=true "confirms" people who never clicked — corrupting the exact
// confirm-rate the Gate-1 funnel runs on. Scanners don't submit forms: the GET
// renders a read-only confirm button and the POST does the write.
//
// Results stay on this route (HTML pages). The old 303 to
// /?newsletter=confirmed (and invalid / error / already-confirmed) was a
// silent homepage: nothing read the query param.

function page(kind: Parameters<typeof renderConfirmLandingHtml>[0], token?: string) {
  return new NextResponse(renderConfirmLandingHtml(kind, { token }), {
    headers: { "Content-Type": "text/html", "X-Robots-Tag": "noindex" },
  });
}

function readToken(request: Request, formToken?: string | null): string | null {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") ?? formToken ?? null;
  if (!token || !TOKEN_RE.test(token)) return null;
  return token;
}

export async function GET(request: Request) {
  const token = readToken(request);
  if (!token) return page("invalid");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return page("error");

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data, error } = await supabase
    .from("newsletter_subscribers")
    .select("confirmed")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (error) return page("error");
  if (!data) return page("invalid");
  if (data.confirmed) return page("already");
  return page("ask", token);
}

export async function POST(request: Request) {
  let formToken: string | null = null;
  try {
    const form = await request.formData();
    const t = form.get("token");
    if (typeof t === "string") formToken = t;
  } catch {
    // no form body — token may still be on the query string
  }

  const token = readToken(request, formToken);
  if (!token) return page("invalid");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return page("error");

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data, error } = await supabase
    .from("newsletter_subscribers")
    .update({ confirmed: true, confirmed_at: new Date().toISOString() })
    .eq("unsubscribe_token", token)
    .eq("confirmed", false)
    .select("id, email")
    .single();

  if (error || !data) {
    const { data: existing } = await supabase
      .from("newsletter_subscribers")
      .select("confirmed")
      .eq("unsubscribe_token", token)
      .maybeSingle();

    if (existing?.confirmed) return page("already");
    return page("invalid");
  }

  // Welcome email on the first confirm — best-effort, never blocks the
  // confirm itself. The confirmed=false guard above means a re-click can't
  // send a second one.
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey && data.email) {
    try {
      const unsubscribeUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=${token}`;
      const welcome = buildWelcomeEmailHtml(unsubscribeUrl);
      await new Resend(resendApiKey).emails.send({
        from: newsletterFromHeader(),
        to: data.email,
        subject: welcome.subject,
        html: welcome.html,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
    } catch (e) {
      console.error("Welcome email failed (confirm still recorded):", e);
    }
  }

  return page("confirmed");
}
