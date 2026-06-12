// The honest-uncertainty disclosure (WS-8), rendered from structured confidence
// fields (lib/confidence.ts) in a distinct note style instead of inline in the
// event description. Shown for community-submitted events we couldn't confirm.
//
// Voice: the "Miss Debbie pattern" from content/VOICE.md — admit the gap, then
// point somewhere useful (call ahead).

export default function ConfidenceNote({
  addedOn,
  phone,
  phoneHref,
}: {
  /** Human date the event was added, e.g. "June 3, 2026". Optional. */
  addedOn?: string | null;
  /** Venue phone to call, if we have one. */
  phone?: string | null;
  phoneHref?: string | null;
}) {
  return (
    <aside className="mt-6 rounded-xl border border-amber-300/70 bg-amber-50/70 px-4 py-3">
      <p className="text-sm leading-relaxed text-stone">
        <span className="font-semibold text-forest">Worth a call first.</span>{" "}
        A neighbor submitted this one{addedOn ? ` on ${addedOn}` : ""}, and I
        haven&apos;t been able to confirm it&apos;s still happening. Check with the
        venue before you make the drive
        {phone ? (
          <>
            :{" "}
            {phoneHref ? (
              <a href={phoneHref} className="font-medium text-pine hover:underline">
                {phone}
              </a>
            ) : (
              <span className="font-medium">{phone}</span>
            )}
            .
          </>
        ) : (
          "."
        )}
      </p>
    </aside>
  );
}
