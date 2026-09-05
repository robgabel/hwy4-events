import { createClient } from "@supabase/supabase-js";
import { NextResponse, after } from "next/server";
import { TOWNS } from "@/lib/types";
import { triageSubmissionById } from "@/lib/agent/submission-triage";
import { normalizeUrl } from "@/lib/url";
import { resolveContact, isContactError, rateLimitKey } from "@/lib/submitter-contact";

// Allow the after() hook (web search + Sonnet) to run in the background of this
// invocation after the fast response. If it overruns, the cron backstop catches it.
export const maxDuration = 60;

const VALID_CATEGORIES = [
  "live_music",
  "festival",
  "civic",
  "hike_walk",
  "kids",
  "wine",
  "games",
  "fine_arts",
  "other",
];

// Optional flyer upload. Vercel caps a serverless request body at 4.5 MB and the
// image is POSTed through this function, so cap at 4 MB for a clean error instead
// of an opaque 413. Mirrors /api/submit-poster.
const MAX_FLYER_BYTES = 4 * 1024 * 1024;
const ALLOWED_FLYER_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Keep the storage key url-safe. */
function safeSegment(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "event";
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  // Multipart so an optional flyer image can be attached alongside the fields.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const str = (k: string) => ((formData.get(k) as string | null) ?? "").trim();

  // Honeypot: a hidden form field no human fills. A non-empty value means a bot
  // auto-populated every input, so drop it silently — pretend success (200) so
  // the bot learns nothing, but never insert or fire the (expensive) triage.
  if (str("company_url")) {
    return NextResponse.json({ ok: true });
  }

  const event_name = str("event_name");
  const event_date = str("event_date");
  const start_time = str("start_time");
  const venue_name = str("venue_name");
  const town = str("town");
  const description = str("description");
  const category = str("category");
  // Accept a bare domain ("mywinery.com") — normalize to a clickable https URL
  // rather than rejecting it (the original feedback: the form "kept asking for a
  // URL" when a bare website was entered).
  const event_url = normalizeUrl(str("event_url"));
  const submitter_name = str("submitter_name");
  // The form now asks for ONE contact method (email or phone) rather than an
  // email only. `submitter_email` is still accepted so an older cached form, or
  // any other client posting the historical shape, keeps working.
  const contact_method = str("contact_method") || "email";
  const contact_value = str("contact_value") || str("submitter_email");
  const flyer = formData.get("flyer");

  // Validate required fields
  if (!event_name?.trim()) {
    return NextResponse.json({ error: "Event name is required" }, { status: 400 });
  }
  if (!event_date?.trim()) {
    return NextResponse.json({ error: "Event date is required" }, { status: 400 });
  }
  if (!town?.trim()) {
    return NextResponse.json({ error: "Town is required" }, { status: 400 });
  }

  // A name and one working contact method are required so a submission can
  // actually be followed up on. Both are validated server-side — the form's
  // `required` attributes are a convenience, not a guarantee.
  if (!submitter_name) {
    return NextResponse.json(
      { error: "Your name is required so we know who sent this in" },
      { status: 400 }
    );
  }

  // Email OR phone, never both: which column is filled IS the stated preference.
  const contact = resolveContact({ method: contact_method, value: contact_value });
  if (isContactError(contact)) {
    return NextResponse.json({ error: contact.error }, { status: 400 });
  }

  // Validate town
  if (!(TOWNS as readonly string[]).includes(town)) {
    return NextResponse.json({ error: "Invalid town" }, { status: 400 });
  }

  // Validate category if provided
  if (category && !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
    return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Per-submitter daily cap: past the honeypot, one submitter can still loop the
  // form and drive one web-search + model triage per submission. Cap how many a
  // given contact can file in 24h. Fails OPEN — a transient count error must
  // never block a genuine neighbor — but a scripted submitter hits the wall fast.
  //
  // Keyed on whichever contact they gave. Keying on the email column alone would
  // leave the phone path completely uncapped.
  const SUBMISSIONS_PER_SUBMITTER_PER_DAY = 10;
  {
    const limitKey = rateLimitKey(contact);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabase
      .from("event_submissions")
      .select("id", { count: "exact", head: true })
      .eq(limitKey.column, limitKey.value)
      .gte("created_at", since);
    if (!countErr && (count ?? 0) >= SUBMISSIONS_PER_SUBMITTER_PER_DAY) {
      return NextResponse.json(
        { error: "You've submitted several events today — thanks! Please try again tomorrow." },
        { status: 429 }
      );
    }
  }

  // Optional flyer: validate + stash in the public event-posters bucket (service
  // role), then store its URL on the submission. The reviewer can use it as the
  // event's poster at publish time. Best-effort within the request; a clean error
  // beats a silent drop.
  let posterUrl: string | null = null;
  let flyerObjectPath: string | null = null;
  if (flyer instanceof File && flyer.size > 0) {
    const ext = ALLOWED_FLYER_TYPES[flyer.type];
    if (!ext) {
      return NextResponse.json(
        { error: "Flyer must be a JPG, PNG, or WebP image" },
        { status: 400 }
      );
    }
    if (flyer.size > MAX_FLYER_BYTES) {
      return NextResponse.json(
        { error: "Flyer must be 4MB or smaller" },
        { status: 400 }
      );
    }
    flyerObjectPath = `submissions/${safeSegment(event_name || town)}/${crypto.randomUUID()}.${ext}`;
    const bytes = await flyer.arrayBuffer();
    const { error: uploadErr } = await supabase.storage
      .from("event-posters")
      .upload(flyerObjectPath, bytes, { contentType: flyer.type, upsert: false });
    if (uploadErr) {
      console.error("Flyer upload failed:", uploadErr);
      return NextResponse.json({ error: "Failed to upload flyer" }, { status: 500 });
    }
    posterUrl = supabase.storage.from("event-posters").getPublicUrl(flyerObjectPath).data.publicUrl;
  }

  const { data: inserted, error } = await supabase
    .from("event_submissions")
    .insert({
      event_name,
      event_date,
      start_time: start_time || null,
      venue_name: venue_name || null,
      town,
      description: description || null,
      category: category || null,
      event_url: event_url || null,
      poster_url: posterUrl,
      submitter_name: submitter_name || null,
      submitter_email: contact.email,
      submitter_phone: contact.phone,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    console.error("Failed to save event submission:", error);
    // Don't leave an orphaned upload behind if the row failed to save.
    if (flyerObjectPath) {
      await supabase.storage.from("event-posters").remove([flyerObjectPath]);
    }
    return NextResponse.json(
      { error: "Failed to save submission" },
      { status: 500 }
    );
  }

  // Fire the agent triage in the background so an opinion is waiting at
  // /admin/submissions when the owner reviews it. Best-effort: any failure is
  // recorded on the row and re-tried by the /api/agent/triage-submissions cron.
  const newId = inserted.id;
  after(async () => {
    try {
      await triageSubmissionById(newId);
    } catch (err) {
      console.error("[submit-event] background triage failed:", err);
    }
  });

  return NextResponse.json({ ok: true });
}
