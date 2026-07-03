import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { SITE_URL, SITE_NAME } from "@/lib/constants";
import { buildWelcomeEmailHtml } from "@/lib/newsletter";

// Scanner-safe double opt-in. Email security scanners (Outlook SafeLinks,
// Mimecast, Gmail) prefetch every GET in a message, so a GET that flips
// confirmed=true "confirms" people who never clicked — corrupting the exact
// confirm-rate the Gate-1 funnel runs on. Scanners don't submit forms: the GET
// renders a read-only confirm button and the POST does the write.

const TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token || !TOKEN_RE.test(token)) {
    return NextResponse.redirect(`${SITE_URL}?newsletter=invalid`);
  }

  return new NextResponse(confirmPage(token), {
    headers: { "Content-Type": "text/html", "X-Robots-Tag": "noindex" },
  });
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  let token = searchParams.get("token");
  if (!token) {
    try {
      const form = await request.formData();
      const t = form.get("token");
      if (typeof t === "string") token = t;
    } catch {
      // no form body — fall through to the invalid redirect
    }
  }

  if (!token || !TOKEN_RE.test(token)) {
    return NextResponse.redirect(`${SITE_URL}?newsletter=invalid`, 303);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.redirect(`${SITE_URL}?newsletter=error`, 303);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data, error } = await supabase
    .from("newsletter_subscribers")
    .update({ confirmed: true, confirmed_at: new Date().toISOString() })
    .eq("unsubscribe_token", token)
    .eq("confirmed", false)
    .select("id, email")
    .single();

  if (error || !data) {
    // Token might already be confirmed
    const { data: existing } = await supabase
      .from("newsletter_subscribers")
      .select("confirmed")
      .eq("unsubscribe_token", token)
      .single();

    if (existing?.confirmed) {
      return NextResponse.redirect(`${SITE_URL}?newsletter=already-confirmed`, 303);
    }
    return NextResponse.redirect(`${SITE_URL}?newsletter=invalid`, 303);
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
        from: `${SITE_NAME} <newsletter@hwy4events.com>`,
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

  return NextResponse.redirect(`${SITE_URL}?newsletter=confirmed`, 303);
}

function confirmPage(token: string): string {
  // token is validated against TOKEN_RE (a bare UUID) before it gets here, so
  // it is safe to embed.
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Confirm subscription — Hwy 4 Events</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #faf9f6;">
  <div style="text-align: center; max-width: 400px; padding: 32px;">
    <h1 style="color: #2d5016; font-size: 20px;">Hwy 4 Events</h1>
    <p style="color: #444; line-height: 1.6;">One more click and you're on the Thursday list.</p>
    <form method="POST" action="/api/newsletter/confirm">
      <input type="hidden" name="token" value="${token}">
      <button type="submit" style="display: inline-block; background: #2d5016; color: white; padding: 12px 24px; border-radius: 8px; border: none; font-size: 16px; font-weight: 600; cursor: pointer;">
        Confirm subscription
      </button>
    </form>
    <p style="color: #888; font-size: 13px; margin-top: 24px;">Didn't sign up? Just close this page.</p>
  </div>
</body>
</html>`;
}
