import {
  resolveSourceReceipt,
  type SourceReceiptInput,
} from "@/lib/source-receipt";

/**
 * "Source: GoCalaveras ↗ (seen October 14, 2026)" on every event page.
 * Separate from the Visit button. A text label (no href) is the honest
 * receipt when the row has no external URL, usually a community submission.
 */
export default function SourceReceipt({
  event,
  className = "mt-4 text-sm text-stone",
}: {
  event: SourceReceiptInput;
  className?: string;
}) {
  const receipt = resolveSourceReceipt(event);
  return (
    <p className={className} data-source-kind={receipt.kind}>
      Source:{" "}
      {receipt.href ? (
        <a
          href={receipt.href}
          target="_blank"
          rel="noopener noreferrer"
          data-otrack="more_info"
          className="cursor-pointer font-medium text-pine underline underline-offset-2 hover:text-forest"
        >
          {receipt.label}
        </a>
      ) : (
        <span className="font-medium text-forest">{receipt.label}</span>
      )}
      {receipt.href ? <span aria-hidden="true"> ↗</span> : null}
      {receipt.seenOn ? ` (seen ${receipt.seenOn})` : null}
    </p>
  );
}
