import { redirect } from "next/navigation";

// The weekly growth memo moved into the unified tabbed /admin/briefings. This
// route is kept as a redirect so existing Slack one-liners and bookmarks pointing
// at /admin/growth-memo still land on the right tab.
export default function GrowthMemoRedirect() {
  redirect("/admin/briefings?view=growth");
}
