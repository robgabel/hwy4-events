import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { TOWNS } from "@/lib/types";

const VALID_CATEGORIES = [
  "live_music",
  "festival",
  "civic",
  "hike_walk",
  "kids",
  "wine",
  "other",
];

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
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

  const { event_name, event_date, start_time, venue_name, town, description, category, event_url, submitter_name, submitter_email } = body as Record<string, string>;

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

  const { error } = await supabase.from("event_submissions").insert({
    event_name: event_name.trim(),
    event_date,
    start_time: start_time?.trim() || null,
    venue_name: venue_name?.trim() || null,
    town,
    description: description?.trim() || null,
    category: category || null,
    event_url: event_url?.trim() || null,
    submitter_name: submitter_name?.trim() || null,
    submitter_email: submitter_email?.trim() || null,
  });

  if (error) {
    console.error("Failed to save event submission:", error);
    return NextResponse.json(
      { error: "Failed to save submission" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
