import React from "react";

interface WeeklyBriefingProps {
  briefing: string;
  generatedAt: string | null;
}

/**
 * Parse markdown-style links [text](url) into React elements.
 * Returns an array of strings and <a> elements.
 */
function renderWithLinks(text: string): React.ReactNode[] {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = linkRegex.exec(text)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // Add the link
    parts.push(
      <a
        key={match.index}
        href={match[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-pine underline decoration-pine/30 underline-offset-2 hover:decoration-pine/60 transition-colors"
      >
        {match[1]}
      </a>
    );
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

export default function WeeklyBriefing({
  briefing,
  generatedAt,
}: WeeklyBriefingProps) {
  const dateLabel = generatedAt
    ? new Date(generatedAt).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div className="mb-8 rounded-xl border border-stone-light/30 bg-white px-6 py-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/millie-happy.svg"
          alt=""
          className="h-6 w-6"
          aria-hidden="true"
        />
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-earth">
          Today on the 4
        </h2>
        {dateLabel && (
          <span className="ml-auto text-xs text-stone-light">{dateLabel}</span>
        )}
      </div>
      {briefing.split("\n\n").map((paragraph, i) => (
        <p key={i} className={`leading-relaxed text-stone-800${i > 0 ? " mt-3" : ""}`}>
          {renderWithLinks(paragraph)}
        </p>
      ))}
    </div>
  );
}
