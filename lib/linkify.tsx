import { Fragment, type ReactNode } from "react";

/**
 * Find US phone numbers in a string and wrap them in <a href="tel:..."> links.
 * Matches the dot-separated format used in our content (209.795.7777) plus
 * the more common dashed and space-separated forms, so future copy that
 * uses any standard pattern still gets linkified.
 *
 * Returns React nodes (string fragments + anchor elements) rather than HTML
 * so callers can drop the result into JSX without dangerouslySetInnerHTML.
 */
const PHONE_RE = /\b(\d{3})[.\-\s](\d{3})[.\-\s](\d{4})\b/g;

export function linkifyPhones(text: string): ReactNode {
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset since /g is stateful.
  PHONE_RE.lastIndex = 0;

  while ((match = PHONE_RE.exec(text)) !== null) {
    const [full, a, b, c] = match;
    const start = match.index;
    if (start > lastIndex) {
      out.push(text.slice(lastIndex, start));
    }
    const digits = `${a}${b}${c}`;
    out.push(
      <a
        key={`tel-${start}`}
        href={`tel:${digits}`}
        className="font-medium text-pine underline decoration-pine/30 hover:decoration-pine"
      >
        {full}
      </a>
    );
    lastIndex = start + full.length;
  }

  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex));
  }

  if (out.length === 0) return text;
  return (
    <>
      {out.map((n, i) => (
        <Fragment key={i}>{n}</Fragment>
      ))}
    </>
  );
}
