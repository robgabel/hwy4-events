import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { SITE_URL, SITE_NAME } from "@/lib/constants";
import { newsletterFromHeader } from "@/lib/newsletter";
import { classifyVisitor, geoFromHeaders } from "@/lib/geo";

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

  // R1b/R1c enrichment: where the signup came from + whether they look local or
  // a visitor. visitor_class is classified server-side from Vercel geo headers;
  // we store the class only, never the IP or city/region (the row is tied to an
  // email). signup_source is a short placement code passed by the form.
  const signupSource =
    typeof body.source === "string" ? body.source.trim().slice(0, 64) || null : null;
  const visitorClass = classifyVisitor(geoFromHeaders(request.headers));

  const supabase = createClient(supabaseUrl, serviceKey);

  // Rate-limit window: at most one confirmation email per email per 10 minutes.
  // Avoids accidental or malicious loops hammering Resend and burning sender
  // reputation. Window is enforced silently — caller always sees the same
  // success message so we don't leak whether the email is in our DB.
  const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

  // Check if already subscribed
  const { data: existing } = await supabase
    .from("newsletter_subscribers")
    .select(
      "id, confirmed, unsubscribed_at, unsubscribe_token, last_confirmation_sent_at"
    )
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
    // Enforce the 10-minute cooldown silently.
    const lastSent = existing.last_confirmation_sent_at
      ? new Date(existing.last_confirmation_sent_at).getTime()
      : 0;
    if (lastSent && Date.now() - lastSent < RESEND_COOLDOWN_MS) {
      return NextResponse.json({ ok: true, message: "Confirmation email sent" });
    }
    // Send confirmation email
    const resend = new Resend(resendApiKey);
    const confirmUrl = `${SITE_URL}/api/newsletter/confirm?token=${existing.unsubscribe_token}`;
    await resend.emails.send({
      from: newsletterFromHeader(),
      to: email,
      subject: `Confirm your ${SITE_NAME} newsletter subscription`,
      html: confirmationEmailHtml(confirmUrl),
    });
    await supabase
      .from("newsletter_subscribers")
      .update({ last_confirmation_sent_at: new Date().toISOString() })
      .eq("id", existing.id);
    return NextResponse.json({ ok: true, message: "Confirmation email sent" });
  }

  // Insert new subscriber
  const { data: newSub, error } = await supabase
    .from("newsletter_subscribers")
    .insert({
      email,
      last_confirmation_sent_at: new Date().toISOString(),
      signup_source: signupSource,
      visitor_class: visitorClass,
    })
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
    from: newsletterFromHeader(),
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
        Thanks for signing up for the <strong>${SITE_NAME}</strong> weekly newsletter!
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
