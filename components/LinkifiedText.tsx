import { Fragment } from "react";

/**
 * Render plain text with bare http(s) URLs turned into clickable links.
 *
 * Event descriptions are stored as plain text and rendered in a single <p>, so a
 * URL in the copy (e.g. a community submitter's Facebook event link) would
 * otherwise show as dead, unclickable text. This keeps the copy readable while
 * making any link in it actually work. External links open in a new tab with
 * noopener. React escapes the text parts, so this is safe against injection.
 */

// Split on http(s) URLs, capturing them so the delimiters survive the split.
const URL_SPLIT = /(https?:\/\/[^\s]+)/g;
// Non-global test (no shared lastIndex) for classifying each part.
const isUrl = (s: string): boolean => /^https?:\/\//.test(s);

export default function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_SPLIT);
  return (
    <>
      {parts.map((part, i) =>
        isUrl(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words text-pine underline underline-offset-2 hover:text-forest"
          >
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}
