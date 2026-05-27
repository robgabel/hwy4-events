"use client";

import { useState } from "react";

export default function NewsletterSignup({
  variant = "default",
  heading,
  description,
}: {
  variant?: "default" | "inline";
  /** Override the default-variant heading. Falls back to "Weekly newsletter". */
  heading?: string;
  /** Override the default-variant description text. Falls back to the
   *  Thursday roundup line. */
  description?: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "Something went wrong.");
        return;
      }
      setStatus("success");
      setMessage("Check your email to confirm your subscription (it may land in a Promotions filter).");
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
          <p className="text-sm text-earth font-medium text-center">{message}</p>
        ) : (
          <div className="sm:flex sm:items-center sm:gap-4">
            <div className="mb-3 sm:mb-0 sm:flex-1">
              <p className="text-sm font-semibold text-earth">
                Like what you see? Get this in your inbox every Thursday.
              </p>
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
        <p className="text-sm text-pine font-medium">{message}</p>
      ) : (
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
      )}
      {status === "error" && (
        <p className="mt-2 text-sm text-red-600">{message}</p>
      )}
    </div>
  );
}
