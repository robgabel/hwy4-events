import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { SITE_URL, SITE_NAME } from "@/lib/constants";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!supabaseUrl || !serviceKey || !resendApiKey) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email as string)?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Valid email address is required" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Check if already subscribed
  const { data: existing } = await supabase
    .from("newsletter_subscribers")
    .select("id, confirmed, unsubscribed_at, unsubscribe_token")
    .eq("email", email)
    .single();

  if (existing) {
    if (existing.confirmed && !existing.unsubscribed_at) {
      return NextResponse.json({ ok: true, message: "Already subscribed" });
    }
    // Re-subscribe: clear unsubscribed_at and resend confirmation if needed
    if (existing.unsubscribed_at) {
      await supabase
        .from("newsletter_subscribers")
        .update({ unsubscribed_at: null, confirmed: false, confirmed_at: null })
        .eq("id", existing.id);
    }
    // Send confirmation email
    const resend = new Resend(resendApiKey);
    const confirmUrl = `${SITE_URL}/api/newsletter/confirm?token=${existing.unsubscribe_token}`;
    await resend.emails.send({
      from: `${SITE_NAME} <newsletter@hwy4events.com>`,
      to: email,
      subject: `Confirm your ${SITE_NAME} newsletter subscription`,
      html: confirmationEmailHtml(confirmUrl),
    });
    return NextResponse.json({ ok: true, message: "Confirmation email sent" });
  }

  // Insert new subscriber
  const { data: newSub, error } = await supabase
    .from("newsletter_subscribers")
    .insert({ email })
    .select("unsubscribe_token")
    .single();

  if (error) {
    console.error("Failed to create subscriber:", error);
    return NextResponse.json(
      { error: "Failed to subscribe" },
      { status: 500 }
    );
  }

  // Send confirmation email
  const resend = new Resend(resendApiKey);
  const confirmUrl = `${SITE_URL}/api/newsletter/confirm?token=${newSub.unsubscribe_token}`;
  await resend.emails.send({
    from: `${SITE_NAME} <newsletter@hwy4events.com>`,
    to: email,
    subject: `Confirm your ${SITE_NAME} newsletter subscription`,
    html: confirmationEmailHtml(confirmUrl),
  });

  return NextResponse.json({ ok: true, message: "Confirmation email sent" });
}

function confirmationEmailHtml(confirmUrl: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
      <h2 style="color: #2d5016; margin-bottom: 16px;">Confirm your subscription</h2>
      <p style="color: #444; line-height: 1.6;">
        Thanks for signing up for the <strong>Hwy 4 Events</strong> weekly newsletter!
        Click the button below to confirm your email and start getting the Thursday roundup.
      </p>
      <a href="${confirmUrl}" style="display: inline-block; background: #2d5016; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 24px 0;">
        Confirm subscription
      </a>
      <p style="color: #888; font-size: 13px; margin-top: 24px;">
        If you didn't sign up for this, you can ignore this email.
      </p>
    </div>
  `;
}
