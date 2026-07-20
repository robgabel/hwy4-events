import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { SITE_URL, SITE_NAME } from "@/lib/constants";
import { REGION } from "@/lib/region";

// Scanner-safe unsubscribe. Email security scanners prefetch every GET in a
// message, and the old GET-with-side-effect silently unsubscribed real
// readers whose corporate mail scans links — a subscriber leak on every
// Thursday send. The GET now renders a read-only button; the POST does the
// write. The POST also serves RFC 8058 one-click unsubscribe (mail clients
// POST to the List-Unsubscribe URL), so "Unsubscribe" in Gmail/Apple Mail
// chrome still works in one tap.

const TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token || !TOKEN_RE.test(token)) {
    return new NextResponse(unsubscribePage("Invalid unsubscribe link."), {
      headers: { "Content-Type": "text/html" },
    });
  }

  return new NextResponse(unsubscribeConfirmPage(token), {
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
      // One-click posts keep the token in the query string; a missing body is
      // fine.
    }
  }

  if (!token || !TOKEN_RE.test(token)) {
    return new NextResponse(unsubscribePage("Invalid unsubscribe link."), {
      headers: { "Content-Type": "text/html" },
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return new NextResponse(unsubscribePage("Something went wrong."), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { error } = await supabase
    .from("newsletter_subscribers")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("unsubscribe_token", token)
    .is("unsubscribed_at", null);

  if (error) {
    return new NextResponse(unsubscribePage("Something went wrong."), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }

  return new NextResponse(
    unsubscribePage(`You've been unsubscribed from the ${SITE_NAME} newsletter. We'll miss you on the 4.`),
    { headers: { "Content-Type": "text/html" } }
  );
}

function unsubscribeConfirmPage(token: string): string {
  // token is validated against TOKEN_RE (a bare UUID) before it gets here, so
  // it is safe to embed.
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unsubscribe — ${SITE_NAME}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #faf9f6;">
  <div style="text-align: center; max-width: 400px; padding: 32px;">
    <h1 style="color: #2d5016; font-size: 20px;">${SITE_NAME}</h1>
    <p style="color: #444; line-height: 1.6;">Stop getting the Thursday roundup?</p>
    <form method="POST" action="/api/newsletter/unsubscribe">
      <input type="hidden" name="token" value="${token}">
      <button type="submit" style="display: inline-block; background: #2d5016; color: white; padding: 12px 24px; border-radius: 8px; border: none; font-size: 16px; font-weight: 600; cursor: pointer;">
        Unsubscribe me
      </button>
    </form>
    <p style="color: #888; font-size: 13px; margin-top: 24px;">
      Changed your mind? <a href="${SITE_URL}" style="color: #2d5016; text-decoration: underline;">Back to ${REGION.siteRef}</a>
    </p>
  </div>
</body>
</html>`;
}

function unsubscribePage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unsubscribe — ${SITE_NAME}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #faf9f6;">
  <div style="text-align: center; max-width: 400px; padding: 32px;">
    <h1 style="color: #2d5016; font-size: 20px;">${SITE_NAME}</h1>
    <p style="color: #444; line-height: 1.6;">${message}</p>
    <a href="${SITE_URL}" style="color: #2d5016; text-decoration: underline;">Back to ${REGION.siteRef}</a>
  </div>
</body>
</html>`;
}
