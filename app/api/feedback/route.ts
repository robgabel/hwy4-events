import { NextResponse } from "next/server";
import { Resend } from "resend";
import { REGION } from "@/lib/region";
import { REGION_OPS } from "@/lib/region-ops";
import { newsletterFromHeader } from "@/lib/newsletter";

export async function POST(request: Request) {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
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

  const message = (body.message as string)?.trim();
  if (!message || message.length < 2) {
    return NextResponse.json(
      { error: "Message is required" },
      { status: 400 }
    );
  }

  if (message.length > 5000) {
    return NextResponse.json(
      { error: "Message is too long" },
      { status: 400 }
    );
  }

  try {
    const resend = new Resend(resendApiKey);
    await resend.emails.send({
      from: newsletterFromHeader(),
      to: REGION_OPS.emails.owner,
      subject: "New Hwy4Events feedback",
      text: `Anonymous feedback from ${REGION.domain}/about:\n\n${message}\n\n---\nSent at ${new Date().toISOString()}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to send feedback:", err);
    return NextResponse.json(
      { error: "Failed to send feedback" },
      { status: 500 }
    );
  }
}
