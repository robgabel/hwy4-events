"use client";

import { useState } from "react";

export default function FeedbackForm() {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorText, setErrorText] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;

    setStatus("loading");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setStatus("error");
        setErrorText(data.error || "Something went wrong.");
        return;
      }
      setStatus("success");
      setMessage("");
    } catch {
      setStatus("error");
      setErrorText("Something went wrong. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-pine/20 bg-pine/5 px-5 py-4 text-center">
        <p className="font-medium text-pine">Thanks for your feedback!</p>
        <button
          onClick={() => setStatus("idle")}
          className="mt-2 cursor-pointer text-sm text-stone hover:text-pine"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What's on your mind?"
        required
        rows={4}
        className="w-full rounded-xl border border-stone-light/40 bg-white px-4 py-3 text-sm text-forest placeholder:text-stone-light/60 focus:border-pine focus:outline-none focus:ring-1 focus:ring-pine"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-stone-light">Anonymous — no email needed</span>
        <button
          type="submit"
          disabled={status === "loading" || !message.trim()}
          className="cursor-pointer rounded-lg bg-pine px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-forest disabled:opacity-50"
        >
          {status === "loading" ? "Sending..." : "Send feedback"}
        </button>
      </div>
      {status === "error" && (
        <p className="mt-2 text-sm text-red-600">{errorText}</p>
      )}
    </form>
  );
}
