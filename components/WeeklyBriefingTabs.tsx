"use client";

import { useState } from "react";

/**
 * Minimal client component: just the tab switcher for today/weekend briefing.
 * All content rendering stays in the server-rendered parent.
 */
export default function WeeklyBriefingTabs({
  weekendTabLabel,
  todayDateLabel,
  weekendDateLabel,
  todayContent,
  weekendContent,
}: {
  weekendTabLabel: string;
  todayDateLabel: string | null;
  weekendDateLabel: string | null;
  todayContent: React.ReactNode;
  weekendContent: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<"today" | "weekend">("today");

  const dateLabel = activeTab === "today" ? todayDateLabel : weekendDateLabel;

  return (
    <>
      {dateLabel && (
        <span className="mb-2 block text-right text-xs text-stone-light">
          {dateLabel}
        </span>
      )}
      <div className="mb-3 flex gap-1 rounded-lg bg-cream p-1">
        <button
          onClick={() => setActiveTab("today")}
          className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "today"
              ? "bg-white text-forest shadow-sm"
              : "text-stone hover:text-forest"
          }`}
        >
          Today
        </button>
        <button
          onClick={() => setActiveTab("weekend")}
          className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "weekend"
              ? "bg-white text-forest shadow-sm"
              : "text-stone hover:text-forest"
          }`}
        >
          {weekendTabLabel}
        </button>
      </div>
      {activeTab === "today" ? todayContent : weekendContent}
    </>
  );
}
