"use client";

import dynamic from "next/dynamic";

const EventMap = dynamic(() => import("./EventMap"), {
  ssr: false,
  loading: () => (
    <div className="mb-6">
      <div className="h-[240px] sm:h-[300px] rounded-lg border border-stone-light/30 bg-warm-white animate-pulse" />
    </div>
  ),
});

export default EventMap;
