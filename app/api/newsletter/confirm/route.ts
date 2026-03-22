import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/constants";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(`${SITE_URL}?newsletter=invalid`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.redirect(`${SITE_URL}?newsletter=error`);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data, error } = await supabase
    .from("newsletter_subscribers")
    .update({ confirmed: true, confirmed_at: new Date().toISOString() })
    .eq("unsubscribe_token", token)
    .eq("confirmed", false)
    .select("id")
    .single();

  if (error || !data) {
    // Token might already be confirmed
    const { data: existing } = await supabase
      .from("newsletter_subscribers")
      .select("confirmed")
      .eq("unsubscribe_token", token)
      .single();

    if (existing?.confirmed) {
      return NextResponse.redirect(`${SITE_URL}?newsletter=already-confirmed`);
    }
    return NextResponse.redirect(`${SITE_URL}?newsletter=invalid`);
  }

  return NextResponse.redirect(`${SITE_URL}?newsletter=confirmed`);
}
