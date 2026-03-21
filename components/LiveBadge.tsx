"use client";

import { useState, useEffect } from "react";
import { getEventLiveStatus, type LiveStatus } from "@/lib/event-time";

interface LiveBadgeProps {
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
}

export default function LiveBadge({
  eventDate,
  startTime,
  endTime,
}: LiveBadgeProps) {
  const [status, setStatus] = useState<LiveStatus>(null);

  useEffect(() => {
    const check = () =>
      setStatus(getEventLiveStatus(eventDate, startTime, endTime));

    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [eventDate, startTime, endTime]);

  if (!status) return null;

  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-red-600">
        <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse-dot" />
        Live
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
      <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse-dot" />
      Starting Soon
    </span>
  );
}
