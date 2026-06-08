"use client";

// Fire-and-forget first-party beacon to /api/track (Gate 0). Uses sendBeacon
// when available so it survives the navigation an outbound click triggers, else
// a keepalive fetch. Never throws — analytics must never break a click.

type TrackPayload =
  | { kind: "view"; path: string; sessionId: string }
  | {
      kind: "outbound";
      path: string;
      eventId?: string | null;
      clickType: string;
      targetUrl?: string | null;
    };

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
