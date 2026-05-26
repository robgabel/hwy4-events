import React from "react";
import Image from "next/image";
import Link from "next/link";
import { SITE_URL } from "@/lib/constants";
import { JsonLd, buildArticle } from "@/lib/schema";
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

  // Fri/Sat/Sun: "Next Weekend" (just generated, covers next week)
  // Mon-Thu: "This Weekend" (that next weekend is now this weekend)
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

  // weekendLabel comes from the API (e.g. "Fri, Apr 3 – Sun, Apr 5")
  const weekendDateLabel = weekendLabel ?? null;

  const title = "Today on the 4";

  // Article schema: makes the briefing a discrete editorial entity that
  // search/AI engines can cite as news with a named author and timestamp.
  const articleSchema = generatedAt
    ? buildArticle({
        headline: hasWeekend
          ? `${title} + ${weekendTabLabel} briefing`
          : title,
        description: briefing.slice(0, 280),
        url: `${SITE_URL}/#briefing`,
        datePublished: generatedAt,
        dateModified: generatedAt,
        authorName: "Rob Gabel",
        authorUrl: `${SITE_URL}/about/rob-gabel`,
      })
    : null;

  return (
    <div className="mb-8 rounded-xl border border-stone-light/30 bg-white px-6 py-5 shadow-sm">
      {articleSchema && <JsonLd data={articleSchema} />}
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
        {/* Date label shown in header only when there's no tab switcher */}
        {!hasWeekend && todayDateLabel && (
          <span className="ml-auto text-xs text-stone-light">
            {todayDateLabel}
          </span>
        )}
      </div>

      {hasWeekend ? (
        <WeeklyBriefingTabs
          weekendTabLabel={weekendTabLabel}
          todayDateLabel={todayDateLabel}
          weekendDateLabel={weekendDateLabel}
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

      {/* Byline. E-E-A-T signal for AI engines, and earns trust with humans
       * who want to know who's writing this. */}
      <p className="mt-4 border-t border-stone-light/20 pt-3 text-xs text-stone-light">
        Curated by{" "}
        <Link
          href="/about/rob-gabel"
          className="font-medium text-pine hover:underline"
        >
          Rob Gabel
        </Link>
        {generatedAt && (
          <>
            {" "}
            &middot; Updated{" "}
            <time dateTime={generatedAt}>
              {new Date(generatedAt).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </time>
          </>
        )}
      </p>
    </div>
  );
}
