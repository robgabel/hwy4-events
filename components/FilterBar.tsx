"use client";

import { EventCategory, CATEGORY_LABELS, TOWNS, Hwy4Org } from "@/lib/types";

interface FilterBarProps {
  selectedCategory: EventCategory | "all";
  selectedTown: string | "all";
  onCategoryChange: (cat: EventCategory | "all") => void;
  onTownChange: (town: string | "all") => void;
  eventCount: number;
  orgs: Hwy4Org[];
  enabledOrgs: Set<string>;
  onToggleOrg: (slug: string) => void;
}

export default function FilterBar({
  selectedCategory,
  selectedTown,
  onCategoryChange,
  onTownChange,
  eventCount,
  orgs,
  enabledOrgs,
  onToggleOrg,
}: FilterBarProps) {
  const categories: (EventCategory | "all")[] = [
    "all",
    "festival",
    "live_music",
    "resort",
    "civic",
    "lodge",
    "other",
  ];

  return (
    <div className="space-y-2 sm:space-y-3">
      <div className="rounded-xl border border-stone-light/40 bg-white p-3 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          {/* Category pills - horizontal scroll on mobile, wrap on desktop */}
          <div className="scrollbar-hide flex gap-1.5 overflow-x-auto sm:flex-wrap sm:gap-2 sm:overflow-visible">
            {categories.map((cat) => {
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => onCategoryChange(cat)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-all sm:px-3.5 ${
                    isActive
                      ? "bg-forest text-white shadow-sm"
                      : "bg-warm-white text-stone hover:bg-sage-light/30 hover:text-forest"
                  }`}
                >
                  {cat === "all" ? "All Events" : CATEGORY_LABELS[cat]}
                </button>
              );
            })}
          </div>

          {/* Town filter + count */}
          <div className="flex items-center gap-3">
            <select
              value={selectedTown}
              onChange={(e) => onTownChange(e.target.value)}
              className="rounded-lg border border-stone-light/50 bg-warm-white px-3 py-1.5 text-sm text-forest focus:border-pine focus:outline-none focus:ring-1 focus:ring-pine/30"
            >
              <option value="all">All Towns</option>
              {TOWNS.map((town) => (
                <option key={town} value={town}>
                  {town}
                </option>
              ))}
            </select>
            <span className="whitespace-nowrap text-sm text-stone">
              {eventCount} event{eventCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Member Events Toggle */}
      {orgs.length > 0 && (
        <div className="rounded-xl border border-stone-light/30 bg-white/60 px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-stone sm:text-xs">
              <svg
                className="h-3 w-3 sm:h-3.5 sm:w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              Member Events
            </span>
            {orgs.map((org) => {
              const isOn = enabledOrgs.has(org.slug);
              return (
                <button
                  key={org.slug}
                  onClick={() => onToggleOrg(org.slug)}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-all sm:px-3 sm:py-1 sm:text-sm ${
                    isOn
                      ? "border-earth/30 bg-earth/10 font-medium text-earth"
                      : "border-stone-light/40 text-stone hover:border-stone hover:text-forest"
                  }`}
                >
                  <span
                    className={`inline-block h-2 w-2 rounded-full transition-colors ${
                      isOn ? "bg-earth" : "bg-stone-light"
                    }`}
                  />
                  {org.display_name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
