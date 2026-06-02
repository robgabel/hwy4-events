import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

async function loadPendingCount(): Promise<number> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return 0;
  const supabase = createClient(supabaseUrl, serviceKey);
  const { count } = await supabase
    .from("hwy4_events")
    .select("id", { count: "exact", head: true })
    .eq("verification_status", "needs_verification");
  return count ?? 0;
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pending = await loadPendingCount();

  return (
    <main
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: "#faf9f6",
        minHeight: "100vh",
        padding: "32px 20px",
      }}
    >
      <div style={{ maxWidth: 940, margin: "0 auto 20px" }}>
        <nav
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            fontSize: 13,
            color: "#666",
            paddingBottom: 16,
            borderBottom: "1px solid #e8e4de",
          }}
        >
          <span style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginRight: 8 }}>
            Admin
          </span>
          <NavLink href="/admin/newsletter">Newsletter</NavLink>
          <NavLink href="/admin/newsletter-note">Newsletter notes</NavLink>
          <NavLink href="/admin/verification">
            Verification
            {pending > 0 && (
              <span
                style={{
                  display: "inline-block",
                  marginLeft: 6,
                  padding: "1px 7px",
                  borderRadius: 10,
                  background: "#d97706",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: 1.4,
                }}
              >
                {pending}
              </span>
            )}
          </NavLink>
        </nav>
      </div>
      {children}
    </main>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        padding: "6px 12px",
        borderRadius: 6,
        color: "#2d5016",
        textDecoration: "none",
        fontWeight: 500,
      }}
    >
      {children}
    </Link>
  );
}
