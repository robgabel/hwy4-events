"use client";

import { useState } from "react";
import Link from "next/link";

const inputClass =
  "w-full rounded-lg border border-stone-light/40 bg-white px-3 py-2 text-sm text-forest placeholder:text-stone-light focus:border-pine focus:outline-none focus:ring-1 focus:ring-pine/30";
const labelClass = "block text-sm font-medium uppercase tracking-wide text-stone mb-1";

export default function ReportEventForm({
  slug,
  eventName,
}: {
  slug: string;
  eventName: string;
}) {
  const [note, setNote] = useState("");
  const [role, setRole] = useState<"" | "organizer" | "visitor">("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/events/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_slug: slug,
          event_name: eventName,
          note,
          submitter_role: role || undefined,
          submitter_name: name,
          submitter_email: email,
          company,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Something went wrong");
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-sage/30 bg-white px-6 py-10 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sage/20">
          <svg
            className="h-6 w-6 text-pine"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="font-display text-xl font-semibold text-forest">Thanks for the note!</h2>
        <p className="mt-2 text-stone">
          We&apos;ll take a look and update the event if it checks out. Nothing changes on the site
          until we review it.
        </p>
        <Link
          href={`/events/${slug}`}
          className="mt-6 inline-block text-sm font-medium text-pine hover:underline"
        >
          &larr; Back to the event
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-stone-light/30 bg-white px-6 py-6 shadow-sm"
    >
      {/* Honeypot: hidden from people, catnip for bots. Off-screen + unfocusable. */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}
      />

      <div className="grid gap-4">
        <div>
          <label className={labelClass}>
            What should we fix? <span className="text-sunset">*</span>
          </label>
          <textarea
            required
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="e.g. Start time is 7pm, not 6. Or: the headliner changed to the Poison Oakies."
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Are you the organizer?</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "" | "organizer" | "visitor")}
            className={inputClass}
          >
            <option value="">Prefer not to say</option>
            <option value="organizer">Yes, I run this event</option>
            <option value="visitor">No, just flagging it</option>
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Your name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Your email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Optional, for a reply"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-stone">
              Only if you&apos;d like us to follow up. We won&apos;t share it.
            </p>
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-forest px-5 py-2.5 text-sm font-medium text-white hover:bg-pine transition-colors disabled:opacity-50"
      >
        {submitting ? "Sending..." : "Send it in"}
      </button>
    </form>
  );
}
