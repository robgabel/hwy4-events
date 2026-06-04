import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/constants";

// Organizer poster swap (PRD-event-poster-loop.md §10). An organizer uploads
// their own poster from the event page; we stash it in the public `event-posters`
// Storage bucket (service role, never anon-direct) and queue a `pending`
// poster_submissions row for human review at /admin/posters. Approve there sets
// hwy4_events.image_url so the poster system shows their art untouched (§9).

// Vercel caps a serverless request body at 4.5 MB, and decision D1 routes the
// upload THROUGH this function (not anon-direct to Storage), so the real ceiling
// is the platform's, not the 8 MB bucket guard. Cap at 4 MB for a clean error
// instead of an opaque 413. Most event flyers are well under this; client-side
// downscaling could lift it later.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Keep the storage key url-safe; slugs already are, but guard against surprises. */
function safeSegment(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "event";
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("poster");
  const eventSlug = ((formData.get("event_slug") as string | null) ?? "").trim();
  const eventId = ((formData.get("event_id") as string | null) ?? "").trim() || null;
  const eventName =
    ((formData.get("event_name") as string | null) ?? "").trim() || eventSlug || "an event";
  const submitterName = ((formData.get("submitter_name") as string | null) ?? "").trim() || null;
  const submitterEmail = ((formData.get("submitter_email") as string | null) ?? "").trim() || null;
  const note = ((formData.get("note") as string | null) ?? "").trim() || null;

  if (!eventSlug) {
    return NextResponse.json({ error: "Missing event" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "Please choose a poster image to upload" },
      { status: 400 }
    );
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Poster must be a JPG, PNG, or WebP image" },
      { status: 400 }
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Poster must be 4MB or smaller" },
      { status: 400 }
    );
  }
  if (submitterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitterEmail)) {
    return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Upload to the public bucket. Service role bypasses RLS without disabling it.
  const objectPath = `${safeSegment(eventSlug)}/${crypto.randomUUID()}.${ext}`;
  const bytes = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage
    .from("event-posters")
    .upload(objectPath, bytes, { contentType: file.type, upsert: false });
  if (uploadErr) {
    console.error("Poster upload failed:", uploadErr);
    return NextResponse.json({ error: "Failed to upload poster" }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("event-posters").getPublicUrl(objectPath);

  const { error: insertErr } = await supabase.from("poster_submissions").insert({
    event_id: eventId,
    event_slug: eventSlug,
    image_url: publicUrl,
    submitter_name: submitterName,
    submitter_email: submitterEmail,
    note,
  });
  if (insertErr) {
    console.error("Poster submission insert failed:", insertErr);
    // Don't leave the orphaned upload behind if the row failed to save.
    await supabase.storage.from("event-posters").remove([objectPath]);
    return NextResponse.json({ error: "Failed to save submission" }, { status: 500 });
  }

  // Ping Slack so a human knows to review it. Best-effort: a webhook hiccup must
  // not fail the submitter, whose poster is already safely queued.
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (webhook) {
    const from = submitterName
      ? `${submitterName}${submitterEmail ? ` (${submitterEmail})` : ""}`
      : submitterEmail || "anonymous";
    const text =
      `*New poster submission* for "${eventName}"\n` +
      `From ${from}` +
      (note ? `\n> ${note}` : "") +
      `\n<${SITE_URL}/admin/posters|Review in admin →>`;
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } catch (err) {
      console.error("Slack poster-submission ping failed:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
