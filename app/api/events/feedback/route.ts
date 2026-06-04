import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/constants";
import { findEventBySlug } from "@/lib/events";

const MAX_NOTE = 4000;

// Public endpoint for "Suggest a fix" on an event page. Captures a free-text
// correction (Phase 1) and pings #hwy4. Writes with the service-role key so the
// table's RLS stays on (never disabled). Phase 2 adds a poster upload.
export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    event_slug,
    event_name,
    note,
    submitter_role,
    submitter_name,
    submitter_email,
    company, // honeypot
  } = body as Record<string, string>;

  // Spam honeypot: real users never fill this hidden field. Accept-and-drop so a
  // bot sees a 200 but no row is written.
  if (company && company.trim()) return NextResponse.json({ ok: true });

  if (!event_slug?.trim()) {
    return NextResponse.json({ error: "Missing event reference" }, { status: 400 });
  }
  const cleanNote = (note ?? "").trim();
  if (!cleanNote) {
    return NextResponse.json({ error: "Please describe what should change" }, { status: 400 });
  }
  if (cleanNote.length > MAX_NOTE) {
    return NextResponse.json({ error: "That note is too long" }, { status: 400 });
  }
  const role =
    submitter_role === "organizer" || submitter_role === "visitor" ? submitter_role : null;
  const email = (submitter_email ?? "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "That email doesn't look right. Fix it or leave it blank." },
      { status: 400 }
    );
  }

  // Resolve the event row from the slug when we can, so the admin links straight
  // to it. Best-effort: slug + name still identify the event if this misses.
  let eventId: string | null = null;
  let resolvedName = event_name?.trim() || null;
  try {
    const ev = await findEventBySlug(event_slug.trim());
    if (ev) {
      eventId = ev.id;
      resolvedName = resolvedName || ev.name;
    }
  } catch {
    // ignore — feedback is worth capturing even without the FK
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { error } = await supabase.from("event_feedback").insert({
    event_id: eventId,
    event_slug: event_slug.trim(),
    event_name: resolvedName,
    note: cleanNote,
    submitter_role: role,
    submitter_name: (submitter_name ?? "").trim() || null,
    submitter_email: email || null,
    user_agent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
  });

  if (error) {
    console.error("Failed to save event feedback:", error);
    return NextResponse.json({ error: "Couldn't save your note. Try again." }, { status: 500 });
  }

  // Ping #hwy4. Best-effort: a Slack outage must never fail the user's submit.
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (webhook) {
    const who = role
      ? `${role}${submitter_name?.trim() ? ` (${submitter_name.trim()})` : ""}`
      : "someone";
    const lines = [
      `📝 *Event feedback* from ${who}`,
      `*${resolvedName || event_slug.trim()}*`,
      `> ${cleanNote.slice(0, 500)}`,
      email ? `Reply: ${email}` : null,
      `Review: ${SITE_URL}/admin/feedback`,
      `Event: ${SITE_URL}/events/${event_slug.trim()}`,
    ].filter(Boolean);
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: lines.join("\n") }),
      });
    } catch {
      // saved regardless
    }
  }

  return NextResponse.json({ ok: true });
}
