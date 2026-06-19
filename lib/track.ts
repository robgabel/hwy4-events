"use client";

// Fire-and-forget first-party beacon to /api/track (Gate 0). Uses sendBeacon
// when available so it survives the navigation an outbound click triggers, else
// a keepalive fetch. Never throws — analytics must never break a click.

type TrackPayload =
  | { kind: "view"; path: string; sessionId: string; src?: string | null }
  | {
      kind: "outbound";
      path: string;
      eventId?: string | null;
      clickType: string;
      targetUrl?: string | null;
      src?: string | null;
    };

// First-touch arrival channel for this session: how the visitor got here.
// Reads ?src on the landing URL (qr / share / host / newsletter / ...), else an
// external referrer host ("ref:google.com"), else null (direct). Persisted in
// sessionStorage so every later in-session view/click reports the channel that
// brought the visitor, not the internal page they happen to be on. Capped at 60
// chars to match the server clamp.
export function firstTouchSrc(): string | null {
  try {
    const KEY = "h4_src";
    const stored = sessionStorage.getItem(KEY);
    if (stored !== null) return stored || null; // "" = resolved to none

    let src: string | null = null;
    const explicit = new URLSearchParams(location.search).get("src");
    if (explicit) {
      src = explicit.slice(0, 60);
    } else if (document.referrer) {
      try {
        const h = new URL(document.referrer).hostname.replace(/^www\./, "");
        const self = location.hostname.replace(/^www\./, "");
        if (h && h !== self) src = ("ref:" + h).slice(0, 60);
      } catch {
        /* malformed referrer; treat as direct */
      }
    }
    sessionStorage.setItem(KEY, src ?? "");
    return src;
  } catch {
    return null;
  }
}

export function track(payload: TrackPayload): void {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/track",
        new Blob([body], { type: "application/json" })
      );
    } else {
      fetch("/api/track", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      });
    }
  } catch {
    // best-effort; ignore
  }
}
