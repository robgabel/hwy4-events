"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track, firstTouchSrc } from "@/lib/track";

/**
 * Gate 0: fires one geo-classifiable view beacon per session+path. The server
 * (/api/track) does the visitor-vs-local geo call from request headers; this just
 * reports the path + an ephemeral session id. Dedupes via sessionStorage so a
 * back/forward or re-render doesn't double-count, and skips the admin area.
 *
 * Mounted once in the root layout. usePathname does not require a Suspense
 * boundary (unlike useSearchParams), so it can sit directly in the tree.
 */
function getSessionId(): string {
  try {
    const k = "h4_sid";
    let id = sessionStorage.getItem(k);
    if (!id) {
      id =
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Date.now().toString(36) + Math.random().toString(36).slice(2));
      sessionStorage.setItem(k, id);
    }
    return id;
  } catch {
    return "nostore";
  }
}

export default function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;

    let seen: Set<string>;
    try {
      seen = new Set(
        JSON.parse(sessionStorage.getItem("h4_seen") ?? "[]") as string[]
      );
    } catch {
      seen = new Set();
    }
    if (seen.has(pathname)) return;
    seen.add(pathname);
    try {
      sessionStorage.setItem("h4_seen", JSON.stringify([...seen]));
    } catch {
      // ignore
    }

    track({ kind: "view", path: pathname, sessionId: getSessionId(), src: firstTouchSrc() });
  }, [pathname]);

  return null;
}
