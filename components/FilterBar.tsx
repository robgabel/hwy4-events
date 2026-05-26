"use client";

import { useState } from "react";
import { EventCategory, CATEGORY_LABELS, TOWNS, Hwy4Org } from "@/lib/types";

const ALL_CATEGORIES: EventCategory[] = [
  "civic",
  "club",
  "festival",
  "live_music",
  "lodge",
  "other",
  "resort",
];

const SORTED_TOWNS = [...TOWNS].sort();

interface FilterBarProps {
  selectedCategories: Set<EventCategory>;
  onCategoriesChange: (cats: Set<EventCategory>) => void;
  selectedTowns: Set<string>;
  onTownsChange: (towns: Set<string>) => void;
  showWeekly: boolean;
  onShowWeeklyChange: (show: boolean) => void;
  eventCount: number;
  orgs: Hwy4Org[];
  enabledOrgs: Set<string>;
  onToggleOrg: (slug: string) => void;
}

function toggleInSet<T>(set: Set<T>, item: T): Set<T> {
  const next = new Set(set);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next;
}

function FilterCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="checkbox-forest"
      />
      <span className="text-sm text-forest">{label}</span>
    </label>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone sm:text-xs">
        {title}
      </span>
    </div>
  );
}

function getSummaryText(
  selectedCategories: Set<EventCategory>,
  selectedTowns: Set<string>,
  showWeekly: boolean,
  enabledOrgs: Set<string>,
  orgs: Hwy4Org[]
): string {
  const parts: string[] = [];

  // Categories
  if (selectedCategories.size === ALL_CATEGORIES.length) {
    parts.push("All types");
  } else if (selectedCategories.size === 0) {
    parts.push("No types");
  } else if (selectedCategories.size <= 2) {
    parts.push(
      [...selectedCategories].map((c) => CATEGORY_LABELS[c]).join(", ")
    );
  } else {
    parts.push(`${selectedCategories.size} of ${ALL_CATEGORIES.length} types`);
  }

  // Towns
  if (selectedTowns.size === SORTED_TOWNS.length) {
    parts.push("All towns");
  } else if (selectedTowns.size === 0) {
    parts.push("No towns");
  } else if (selectedTowns.size <= 2) {
    parts.push([...selectedTowns].join(", "));
  } else {
    parts.push(`${selectedTowns.size} of ${SORTED_TOWNS.length} towns`);
  }

  // Weekly
  if (!showWeekly) {
    parts.push("no recurring");
  }

  // Clubs
  const enabledOrgNames = orgs
    .filter((o) => enabledOrgs.has(o.slug))
    .map((o) => o.display_name);
  if (enabledOrgNames.length > 0) {
    parts.push(`+ ${enabledOrgNames.join(", ")}`);
  }

  return parts.join(" · ");
}

export default function FilterBar({
  selectedCategories,
  onCategoriesChange,
  selectedTowns,
  onTownsChange,
  showWeekly,
  onShowWeeklyChange,
  eventCount,
  orgs,
  enabledOrgs,
  onToggleOrg,
}: FilterBarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const summary = getSummaryText(
    selectedCategories,
    selectedTowns,
    showWeekly,
    enabledOrgs,
    orgs
  );

  const memberOrgs = orgs;

  return (
    <div className="rounded-xl border border-stone-light/40 bg-white shadow-sm">
      {/* Summary bar — always visible */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-warm-white/50 sm:px-5 sm:py-3"
      >
        {/* Filter icon */}
        <svg
          className="h-4 w-4 shrink-0 text-pine"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>

        <span className="text-[10px] font-semibold uppercase tracking-wider text-stone sm:text-xs">
          Filters
        </span>

        {/* Summary text */}
        <span className="min-w-0 flex-1 truncate text-xs text-stone sm:text-sm">
          {summary}
        </span>

        {/* Event count */}
        <span className="shrink-0 whitespace-nowrap text-xs font-medium text-pine sm:text-sm">
          {eventCount} event{eventCount !== 1 ? "s" : ""}
        </span>

        {/* Chevron */}
        <svg
          className={`h-4 w-4 shrink-0 text-stone transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Expandable panel */}
      <div
        className="filter-panel"
        data-open={isOpen}
      >
        <div>
          <div className="border-t border-stone-light/30 px-3 pb-3 pt-3 sm:px-5 sm:pb-4 sm:pt-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4 sm:gap-x-6">
              {/* Event Type */}
              <div>
                <SectionHeader title="Event Type" />
                <div className="space-y-0.5">
                  {ALL_CATEGORIES.map((cat) => (
                    <FilterCheckbox
                      key={cat}
                      checked={selectedCategories.has(cat)}
                      onChange={() =>
                        onCategoriesChange(
                          toggleInSet(selectedCategories, cat)
                        )
                      }
                      label={CATEGORY_LABELS[cat]}
                    />
                  ))}
                </div>
              </div>

              {/* Cities */}
              <div>
                <SectionHeader title="Cities" />
                <div className="space-y-0.5">
                  {SORTED_TOWNS.map((town) => (
                    <FilterCheckbox
                      key={town}
                      checked={selectedTowns.has(town)}
                      onChange={() =>
                        onTownsChange(toggleInSet(selectedTowns, town))
                      }
                      label={town}
                    />
                  ))}
                </div>
              </div>

              {/* Recurring */}
              <div>
                <div className="mb-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-stone sm:text-xs">
                    Recurring
                  </span>
                </div>
                <FilterCheckbox
                  checked={showWeekly}
                  onChange={onShowWeeklyChange}
                  label="Weekly"
                />
              </div>

              {/* Clubs */}
              {memberOrgs.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone sm:text-xs">
                      <svg
                        className="h-3 w-3"
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
                      Clubs
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {memberOrgs.map((org) => (
                      <FilterCheckbox
                        key={org.slug}
                        checked={enabledOrgs.has(org.slug)}
                        onChange={() => onToggleOrg(org.slug)}
                        label={org.display_name}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
