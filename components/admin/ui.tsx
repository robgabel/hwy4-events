import type { CSSProperties, ReactNode } from "react";

// Shared admin building blocks. Every /admin queue page used to redefine its own
// Banner, button styles, card shell, and empty state inline; this is the one copy.
//
// Color comes from the site's real brand tokens (mirror of app/globals.css @theme),
// not the old ad-hoc admin palette. Change a value here and the whole admin tree
// (every page that imports the kit) re-brands at once.
export const INK = "#1B3A2D"; // forest — headings, links, primary buttons
export const MUTED = "#6E6153"; // stone — body / meta text (WCAG-AA on cream)
export const SUBTLE = "#8A7B66"; // stone-light — labels, placeholders
export const ACCENT = "#C4922A"; // gold — "needs review" accents + nav badge
export const DANGER = "#922b21"; // destructive actions (no brand red; kept)
export const BORDER = "#E7E0D5"; // one warm hairline border value
export const PAGE_BG = "#FDF8F3"; // cream — page background
export const CARD_BG = "#FFFFFF";
export const SUBTLE_BG = "#F7F2EA"; // cream-tinted fill (secondary buttons, tiles)
export const ADMIN_MAX_WIDTH = 940;

export const adminInput: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  fontSize: 16,
  color: INK,
  background: CARD_BG,
  boxSizing: "border-box",
};

export const adminBtn: Record<"primary" | "secondary" | "danger", CSSProperties> = {
  primary: {
    padding: "10px 18px",
    background: INK,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },
  secondary: {
    padding: "10px 16px",
    background: SUBTLE_BG,
    color: INK,
    border: `1px solid ${INK}`,
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 500,
    cursor: "pointer",
  },
  danger: {
    padding: "10px 16px",
    background: "#fff",
    color: DANGER,
    border: "1px solid #e6b8b3",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 500,
    cursor: "pointer",
  },
};

export function Banner({ tone, children }: { tone: "ok" | "error"; children: ReactNode }) {
  const s =
    tone === "ok"
      ? { background: "#eaf3ea", border: "1px solid #b7d3b7", color: INK }
      : { background: "#fdecea", border: "1px solid #f5b7b1", color: DANGER };
  return (
    <div style={{ ...s, padding: "12px 16px", borderRadius: 8, fontSize: 16, marginBottom: 16 }}>
      {children}
    </div>
  );
}

// The page frame shared by every admin list/queue page: centered column, title,
// intro, and the standard error/flash banners. The page supplies the body.
export function QueueShell({
  title,
  intro,
  error,
  flash,
  children,
}: {
  title: string;
  intro: ReactNode;
  error?: string | null;
  flash?: string | null;
  children: ReactNode;
}) {
  return (
    <div style={{ maxWidth: ADMIN_MAX_WIDTH, margin: "0 auto" }}>
      <h1 style={{ color: INK, fontSize: 26, margin: "0 0 4px" }}>{title}</h1>
      <p style={{ color: MUTED, fontSize: 16, margin: "0 0 24px", lineHeight: 1.5 }}>{intro}</p>
      {error && <Banner tone="error">{error}</Banner>}
      {flash && <Banner tone="ok">{flash}</Banner>}
      {children}
    </div>
  );
}

export function EmptyCard({ heading, sub }: { heading: string; sub: ReactNode }) {
  return (
    <section
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: 32,
        textAlign: "center",
      }}
    >
      <p style={{ color: INK, fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>{heading}</p>
      <p style={{ color: MUTED, fontSize: 16, margin: 0 }}>{sub}</p>
    </section>
  );
}

// Vertical stack of cards with the standard gap.
export function CardList({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>;
}

// White card with the standard accent left-border. Each queue passes its own
// accent (gold for "needs review", forest for organizer, etc.).
export function QueueCard({ accent = ACCENT, children }: { accent?: string; children: ReactNode }) {
  return (
    <article
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 12,
        padding: 20,
      }}
    >
      {children}
    </article>
  );
}

export function CardHeader({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <header style={{ marginBottom: 12 }}>
      <h2 style={{ color: INK, fontSize: 19, margin: "0 0 4px", fontWeight: 600 }}>{title}</h2>
      {meta != null && <p style={{ color: MUTED, fontSize: 15, margin: 0 }}>{meta}</p>}
    </header>
  );
}

// Compact labeled link tile (used in the verification queue's link grid).
export function LinkBox({
  label,
  href,
  note,
  external = false,
}: {
  label: string;
  href: string;
  note: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      style={{
        display: "block",
        background: SUBTLE_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: "8px 12px",
        textDecoration: "none",
        color: INK,
      }}
    >
      <p
        style={{
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: SUBTLE,
          margin: "0 0 2px",
        }}
      >
        {label} {external && "↗"}
      </p>
      <p
        style={{
          fontSize: 15,
          color: INK,
          margin: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {note}
      </p>
    </a>
  );
}
