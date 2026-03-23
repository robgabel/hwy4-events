"use client";

import { useState } from "react";

/**
 * Minimal client component: just the tab switcher for today/weekend briefing.
 * All content rendering stays in the server-rendered parent.
 */
export default function WeeklyBriefingTabs({
  weekendTabLabel,
  todayContent,
  weekendContent,
}: {
  weekendTabLabel: string;
  todayContent: React.ReactNode;
  weekendContent: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<"today" | "weekend">("today");

  return (
    <>
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
