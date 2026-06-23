import { redirect } from "next/navigation";

// /admin has no content of its own — the Inbox is the cockpit home.
export const dynamic = "force-dynamic";

export default function AdminIndex() {
  redirect("/admin/inbox");
}
