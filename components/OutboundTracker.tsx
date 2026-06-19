"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track, firstTouchSrc } from "@/lib/track";

/**
 * Gate 0: delegated outbound-click tracker for the event detail page. Listens
 * once at the document level and fires a beacon whenever a click lands on an
 * anchor tagged data-otrack="<click_type>" — the "More info" CTA, Get Directions,
 * or a venue's website/phone/maps link. The server components stay untouched;
 * they just carry the data attribute. sendBeacon survives the navigation.
 *
 * Capture phase so it still fires if a nested handler stops propagation.
 */
export default function OutboundTracker({ eventId }: { eventId: string }) {
  const pathname = usePathname();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const el = target?.closest?.(
        "a[data-otrack]"
      ) as HTMLAnchorElement | null;
      if (!el) return;
      const clickType = el.getAttribute("data-otrack");
      if (!clickType) return;
      track({
        kind: "outbound",
        path: pathname ?? "",
        eventId,
        clickType,
        targetUrl: el.getAttribute("href"),
        src: firstTouchSrc(),
      });
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [eventId, pathname]);

  return null;
}
