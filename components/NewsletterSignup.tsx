"use client";

import { useState } from "react";

export default function NewsletterSignup() {
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
      setMessage("Check your email to confirm your subscription.");
      setEmail("");
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  return (
    <div className="mb-8 rounded-xl border border-stone-light/30 bg-cream px-6 py-5">
      <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-earth mb-2">
        Weekly newsletter
      </h3>
      <p className="text-sm text-stone mb-3">
        Get the Thursday roundup — what&apos;s happening this weekend and next week on the 4.
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
            className="rounded-lg bg-pine px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-forest disabled:opacity-50"
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
