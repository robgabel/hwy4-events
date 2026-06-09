import { redirect } from "next/navigation";

// The daily digest moved into the unified tabbed /admin/briefings. This route is
// kept as a redirect so existing Slack one-liners and bookmarks pointing at
// /admin/today still land on the right view.
export default function TodayRedirect() {
  redirect("/admin/briefings");
}
