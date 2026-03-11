"use client";

import { EventCategory, CATEGORY_LABELS, TOWNS } from "@/lib/types";

interface FilterBarProps {
  selectedCategory: EventCategory | "all";
  selectedTown: string | "all";
  onCategoryChange: (cat: EventCategory | "all") => void;
  onTownChange: (town: string | "all") => void;
  eventCount: number;
}

export default function FilterBar({
  selectedCategory,
  selectedTown,
  onCategoryChange,
  onTownChange,
  eventCount,
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
    <div className="rounded-xl border border-stone-light/40 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Category pills */}
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => {
            const isActive = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => onCategoryChange(cat)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-all ${
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
  );
}
