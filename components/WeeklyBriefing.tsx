interface WeeklyBriefingProps {
  briefing: string;
  generatedAt: string | null;
}

export default function WeeklyBriefing({
  briefing,
  generatedAt,
}: WeeklyBriefingProps) {
  const dateLabel = generatedAt
    ? new Date(generatedAt).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : null;

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
          The Week on the 4
        </h2>
        {dateLabel && (
          <span className="ml-auto text-xs text-stone-light">{dateLabel}</span>
        )}
      </div>
      <p className="leading-relaxed text-stone-800">{briefing}</p>
    </div>
  );
}
