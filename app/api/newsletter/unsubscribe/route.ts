import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
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
    unsubscribePage("You've been unsubscribed from the Hwy 4 Events newsletter. We'll miss you on the 4."),
    { headers: { "Content-Type": "text/html" } }
  );
}

function unsubscribePage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unsubscribe — Hwy 4 Events</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #faf9f6;">
  <div style="text-align: center; max-width: 400px; padding: 32px;">
    <h1 style="color: #2d5016; font-size: 20px;">Hwy 4 Events</h1>
    <p style="color: #444; line-height: 1.6;">${message}</p>
    <a href="https://hwy4events.com" style="color: #2d5016; text-decoration: underline;">Back to Hwy4Events.com</a>
  </div>
</body>
</html>`;
}
