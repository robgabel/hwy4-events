"use client";

import { useState } from "react";
import { firstTouchSrc } from "@/lib/track";
import {
  SIGNUP_EXPECTATION,
  alreadySubscribedCopy,
  checkEmailCopy,
  type SubscribeOutcome,
} from "@/lib/newsletter-confirm";

export default function NewsletterSignup({
  variant = "default",
  heading,
  description,
  source,
}: {
  variant?: "default" | "inline";
  /** Override the default-variant heading. Falls back to "Weekly newsletter". */
  heading?: string;
  /** Override the default-variant description text. Falls back to the
   *  Thursday roundup line. */
  description?: string;
  /** Short placement code stored on the subscriber for attribution (R1b),
   *  e.g. "homepage_event5", "temporal_weekend", "town_murphys". */
  source?: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [outcome, setOutcome] = useState<SubscribeOutcome>("check_email");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    try {
      // Prefer the explicit placement code (e.g. "homepage_event5"); when a
      // caller didn't set one, fall back to the arrival channel so no signup is
      // unattributed (was the source of all the NULL signup_source rows).
      const attribution = source ?? firstTouchSrc() ?? undefined;
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), source: attribution }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "Something went wrong.");
        return;
      }
      setOutcome(data.outcome === "already_subscribed" ? "already_subscribed" : "check_email");
      setStatus("success");
      setEmail("");
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  if (variant === "inline") {
    return (
      <div className="mb-6 rounded-xl border-2 border-sunset/50 bg-sunset/10 px-5 py-4 shadow-sm">
        {status === "success" ? (
          <SuccessState outcome={outcome} compact />
        ) : (
          <div className="sm:flex sm:items-center sm:gap-4">
            <div className="mb-3 sm:mb-0 sm:flex-1">
              <p className="text-sm font-semibold text-earth">
                {heading ?? "Like what you see? Get this in your inbox every Thursday."}
              </p>
              {description && (
                <p className="mt-1 text-xs leading-relaxed text-stone">{description}</p>
              )}
              <p className="mt-1 text-xs text-stone">{SIGNUP_EXPECTATION}</p>
            </div>
            <form onSubmit={handleSubmit} className="flex gap-2 sm:flex-shrink-0">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full rounded-lg border border-stone-light/40 bg-white px-3 py-1.5 text-sm text-stone-800 placeholder:text-stone-light/60 focus:border-sunset focus:outline-none focus:ring-1 focus:ring-sunset sm:w-48"
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="cursor-pointer rounded-lg bg-sunset px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-earth disabled:opacity-50"
              >
                {status === "loading" ? "..." : "Subscribe"}
              </button>
            </form>
          </div>
        )}
        {status === "error" && (
          <p className="mt-2 text-sm text-red-600">{message}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mb-8 rounded-xl border border-stone-light/30 bg-cream px-6 py-5">
      <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-earth mb-2">
        {heading ?? "Weekly newsletter"}
      </h3>
      <p className="text-sm text-stone mb-3">
        {description ??
          "Get the Thursday roundup. What's happening this weekend and next week on the 4."}
      </p>
      {status === "success" ? (
        <SuccessState outcome={outcome} />
      ) : (
        <>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="flex-1 rounded-lg border border-stone-light/40 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-light/60 focus:border-pine focus:outline-none focus:ring-1 focus:ring-pine"
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="cursor-pointer rounded-lg bg-pine px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-forest disabled:opacity-50"
            >
              {status === "loading" ? "..." : "Subscribe"}
            </button>
          </form>
          <p className="mt-2 text-xs text-stone">{SIGNUP_EXPECTATION}</p>
        </>
      )}
      {status === "error" && (
        <p className="mt-2 text-sm text-red-600">{message}</p>
      )}
    </div>
  );
}

function SuccessState({
  outcome,
  compact = false,
}: {
  outcome: SubscribeOutcome;
  compact?: boolean;
}) {
  if (outcome === "already_subscribed") {
    const copy = alreadySubscribedCopy();
    return (
      <div role="status">
        <p className={`font-medium text-pine ${compact ? "text-sm text-center" : "text-sm"}`}>
          {copy.heading}
        </p>
        <p className={`text-stone ${compact ? "mt-1 text-center text-xs" : "mt-1 text-sm"}`}>
          {copy.note}
        </p>
      </div>
    );
  }

  const copy = checkEmailCopy();
  return (
    <div role="status">
      <p className={`font-medium text-pine ${compact ? "text-sm text-center" : "text-sm"}`}>
        {copy.heading}
      </p>
      {compact ? (
        <p className="mt-1 text-center text-xs text-stone">
          From {copy.fromLabel}. Subject: {copy.subject}. {copy.note}
        </p>
      ) : (
        <>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-stone">
            {copy.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mt-2 text-sm text-stone">{copy.note}</p>
        </>
      )}
    </div>
  );
}
