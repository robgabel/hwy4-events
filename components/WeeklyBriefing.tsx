import React from "react";
import Image from "next/image";
import WeeklyBriefingTabs from "./WeeklyBriefingTabs";

interface WeeklyBriefingProps {
  briefing: string;
  generatedAt: string | null;
  weekendBriefing?: string | null;
  weekendGeneratedAt?: string | null;
  weekendLabel?: string | null;
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
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
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

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

function BriefingContent({
  text,
  generatedAt,
}: {
  text: string;
  generatedAt: string | null;
}) {
  const paragraphs = text.split("\n\n").map((p) => renderWithLinks(p));
  return (
    <>
      {paragraphs.map((nodes, i) => (
        <p
          key={i}
          className={`leading-relaxed text-stone-800${i > 0 ? " mt-3" : ""}`}
        >
          {nodes}
        </p>
      ))}
    </>
  );
}

export default function WeeklyBriefing({
  briefing,
  generatedAt,
  weekendBriefing,
  weekendGeneratedAt,
  weekendLabel,
}: WeeklyBriefingProps) {
  const hasWeekend = !!weekendBriefing;

  // Smart "This/Next Weekend" — computed at render time (server)
  const todayDay = new Date().getDay();
  const isCurrentlyWeekend = todayDay === 0 || todayDay === 5 || todayDay === 6;
  const weekendTabLabel = isCurrentlyWeekend ? "Next Weekend" : "This Weekend";

  const todayDateLabel = generatedAt
    ? new Date(generatedAt).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : null;

  const title = "Today on the 4";

  return (
    <div className="mb-8 rounded-xl border border-stone-light/30 bg-white px-6 py-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Image
          src="/millie-happy.svg"
          alt=""
          width={24}
          height={24}
          aria-hidden="true"
        />
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-earth">
          {title}
        </h2>
        {todayDateLabel && (
          <span className="ml-auto text-xs text-stone-light">
            {todayDateLabel}
          </span>
        )}
      </div>

      {hasWeekend ? (
        <WeeklyBriefingTabs
          weekendTabLabel={weekendTabLabel}
          todayContent={
            <BriefingContent text={briefing} generatedAt={generatedAt} />
          }
          weekendContent={
            <BriefingContent
              text={weekendBriefing!}
              generatedAt={weekendGeneratedAt ?? null}
            />
          }
        />
      ) : (
        <BriefingContent text={briefing} generatedAt={generatedAt} />
      )}
    </div>
  );
}
