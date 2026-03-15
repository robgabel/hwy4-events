interface DateLogEntry {
  date: string;
  label: string;
  dayName: string;
  header: string;
}

interface WeekNarrativeProps {
  narrative: string;
  dateLog: DateLogEntry[];
  generatedAt: string;
}

export default function WeekNarrative({
  narrative,
  dateLog,
  generatedAt,
}: WeekNarrativeProps) {
  // Find the first date's header for the section title
  const firstDate = dateLog.length > 0 ? dateLog[0] : null;

  return (
    <section className="mb-8 rounded-xl border border-stone-light/30 bg-white px-6 py-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <svg
          className="h-5 w-5 text-pine"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
        <h2 className="text-lg font-semibold text-earth">The Week on the 4</h2>
      </div>

      {firstDate && (
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-light">
          {firstDate.header}
        </p>
      )}

      <div className="space-y-3 text-sm leading-relaxed text-stone">
        {narrative.split("\n\n").map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
    </section>
  );
}
