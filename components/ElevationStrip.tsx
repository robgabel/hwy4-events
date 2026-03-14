"use client";

import { CORRIDOR_TOWNS, TOWN_INFO } from "@/lib/towns";

interface ElevationStripProps {
  selectedTown: string | "all";
  onTownChange: (town: string | "all") => void;
}

export default function ElevationStrip({
  selectedTown,
  onTownChange,
}: ElevationStripProps) {
  const minElev = CORRIDOR_TOWNS[0].elevation;
  const maxElev = CORRIDOR_TOWNS[CORRIDOR_TOWNS.length - 1].elevation;
  const range = maxElev - minElev;

  // Position each town along the strip (0-100%)
  const towns = CORRIDOR_TOWNS.map((t) => ({
    ...t,
    x: ((t.elevation - minElev) / range) * 100,
    // Normalized y for the elevation curve (0 = bottom, 1 = top)
    y: (t.elevation - minElev) / range,
  }));

  // Build SVG path for the elevation profile
  const svgWidth = 800;
  const svgHeight = 60;
  const padding = 40;
  const usableWidth = svgWidth - padding * 2;

  const points = towns.map((t) => ({
    x: padding + (t.x / 100) * usableWidth,
    y: svgHeight - 8 - t.y * (svgHeight - 20),
  }));

  // Smooth curve through points
  const pathD = points.reduce((acc, point, i) => {
    if (i === 0) return `M ${point.x} ${point.y}`;
    const prev = points[i - 1];
    const cpx = (prev.x + point.x) / 2;
    return `${acc} C ${cpx} ${prev.y} ${cpx} ${point.y} ${point.x} ${point.y}`;
  }, "");

  const selectedInfo =
    selectedTown !== "all" ? TOWN_INFO[selectedTown] : null;

  return (
    <div className="rounded-xl border border-stone-light/30 bg-white/60 px-2 py-2 sm:px-4 sm:py-3">
      {/* Elevation profile SVG */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="h-10 w-full sm:h-14"
          preserveAspectRatio="none"
        >
          {/* Elevation line */}
          <path
            d={pathD}
            fill="none"
            stroke="#C4B8AA"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* Fill below the line */}
          <path
            d={`${pathD} L ${points[points.length - 1].x} ${svgHeight} L ${points[0].x} ${svgHeight} Z`}
            fill="#C4B8AA"
            fillOpacity="0.08"
          />
        </svg>

        {/* Town markers overlaid on the SVG */}
        <div className="absolute inset-0 flex items-end">
          {towns.map((town) => {
            const isSelected = selectedTown === town.name;
            const leftPercent =
              ((padding + (town.x / 100) * usableWidth) / svgWidth) * 100;
            return (
              <button
                key={town.name}
                onClick={() =>
                  onTownChange(isSelected ? "all" : town.name)
                }
                className="absolute -translate-x-1/2 transform"
                style={{ left: `${leftPercent}%`, bottom: "2px" }}
                title={`${town.name} · ${town.elevation.toLocaleString()} ft`}
              >
                <span
                  className={`block h-2 w-2 rounded-full border-2 transition-all ${
                    isSelected
                      ? "scale-150 border-pine bg-pine"
                      : "border-stone-light bg-white hover:border-pine hover:bg-pine/20"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Town labels */}
      <div className="mt-1 flex justify-between px-1 sm:mt-1.5">
        <span className="text-[9px] text-stone-light sm:text-[10px]">
          Angels Camp
          <span className="hidden sm:inline"> · 1,300 ft</span>
        </span>
        <span className="text-[9px] text-stone-light sm:text-[10px]">
          Bear Valley
          <span className="hidden sm:inline"> · 7,000 ft</span>
        </span>
      </div>

      {/* Selected town info */}
      {selectedInfo && (
        <div className="mt-1.5 flex items-center justify-center gap-2 text-xs text-stone">
          <span className="font-medium text-forest">{selectedInfo.name}</span>
          <span className="text-stone-light">·</span>
          <span>{selectedInfo.tagline}</span>
          <span className="text-stone-light">·</span>
          <span>{selectedInfo.elevation.toLocaleString()} ft</span>
        </div>
      )}
    </div>
  );
}
