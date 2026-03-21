"use client";

import React, { useState } from "react";

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
  weekendBriefing,
  weekendGeneratedAt,
  weekendLabel,
}: WeeklyBriefingProps) {
  const hasWeekend = !!weekendBriefing;
  const [activeTab, setActiveTab] = useState<"today" | "weekend">("today");

  const isWeekend = activeTab === "weekend" && hasWeekend;
  const activeBriefing = isWeekend ? weekendBriefing! : briefing;
  const activeGeneratedAt = isWeekend ? weekendGeneratedAt : generatedAt;

  const dateLabel = activeGeneratedAt
    ? new Date(activeGeneratedAt).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : null;

  // Smart "This/Next Weekend" — if today is Fri/Sat/Sun, the weekend briefing
  // covers NEXT weekend, so label accordingly. Mon-Thu it's "This Weekend".
  const todayDay = new Date().getDay(); // 0=Sun, 5=Fri, 6=Sat
  const isCurrentlyWeekend = todayDay === 0 || todayDay === 5 || todayDay === 6;
  const weekendTabLabel = isCurrentlyWeekend ? "Next Weekend" : "This Weekend";

  const title = isWeekend
    ? `${weekendTabLabel.replace("Weekend", "Weekend on the 4")}`
    : "Today on the 4";
  const subtitle = isWeekend && weekendLabel ? weekendLabel : null;

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
          {title}
        </h2>
        {subtitle && (
          <span className="text-xs text-stone-light">{subtitle}</span>
        )}
        {dateLabel && !subtitle && (
          <span className="ml-auto text-xs text-stone-light">{dateLabel}</span>
        )}
      </div>

      {hasWeekend && (
        <div className="mb-3 flex gap-1 rounded-lg bg-cream p-1">
          <button
            onClick={() => setActiveTab("today")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "today"
                ? "bg-white text-forest shadow-sm"
                : "text-stone hover:text-forest"
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setActiveTab("weekend")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "weekend"
                ? "bg-white text-forest shadow-sm"
                : "text-stone hover:text-forest"
            }`}
          >
            {weekendTabLabel}
          </button>
        </div>
      )}

      {activeBriefing.split("\n\n").map((paragraph, i) => (
        <p key={i} className={`leading-relaxed text-stone-800${i > 0 ? " mt-3" : ""}`}>
          {renderWithLinks(paragraph)}
        </p>
      ))}
    </div>
  );
}
