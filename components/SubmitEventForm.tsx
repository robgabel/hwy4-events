"use client";

import { useState } from "react";
import { TOWNS, CATEGORY_LABELS, type EventCategory } from "@/lib/types";
import { normalizeUrl } from "@/lib/url";
import Link from "next/link";

const MAX_FLYER_BYTES = 4 * 1024 * 1024;

interface FormData {
  event_name: string;
  event_date: string;
  start_time: string;
  venue_name: string;
  town: string;
  description: string;
  category: string;
  event_url: string;
  submitter_name: string;
  submitter_email: string;
}

const INITIAL_FORM: FormData = {
  event_name: "",
  event_date: "",
  start_time: "",
  venue_name: "",
  town: "",
  description: "",
  category: "",
  event_url: "",
  submitter_name: "",
  submitter_email: "",
};

export default function SubmitEventForm() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [flyer, setFlyer] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }

  function onFlyerChange(file: File | null) {
    setError(null);
    if (file && file.size > MAX_FLYER_BYTES) {
      setError("That flyer is over 4MB. Please pick a smaller image.");
      setFlyer(null);
      return;
    }
    setFlyer(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      // Multipart (not JSON) so an optional flyer image can ride along. The
      // browser sets the multipart Content-Type/boundary itself, so we don't.
      const body = new FormData();
      for (const [key, value] of Object.entries(form)) {
        body.append(key, value);
      }
      if (flyer) body.append("flyer", flyer);

      const res = await fetch("/api/submit-event", {
        method: "POST",
        body,
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
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h2 className="font-display text-xl font-semibold text-forest">
          Thanks for the tip!
        </h2>
        <p className="mt-2 text-stone">
          We&apos;ll review your submission and add it to the site if it fits.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm font-medium text-pine hover:underline"
        >
          &larr; Back to events
        </Link>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-stone-light/40 bg-white px-3 py-2 text-sm text-forest placeholder:text-stone-light focus:border-pine focus:outline-none focus:ring-1 focus:ring-pine/30";
  const labelClass =
    "block text-sm font-medium uppercase tracking-wide text-stone mb-1";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-stone-light/30 bg-white px-6 py-6 shadow-sm"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>
            Event Name <span className="text-sunset">*</span>
          </label>
          <input
            type="text"
            required
            value={form.event_name}
            onChange={(e) => update("event_name", e.target.value)}
            placeholder="e.g. Friday Night Jazz"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>
            Date <span className="text-sunset">*</span>
          </label>
          <input
            type="date"
            required
            value={form.event_date}
            onChange={(e) => update("event_date", e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Start Time</label>
          <input
            type="time"
            value={form.start_time}
            onChange={(e) => update("start_time", e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Venue / Location</label>
          <input
            type="text"
            value={form.venue_name}
            onChange={(e) => update("venue_name", e.target.value)}
            placeholder="e.g. The Lube Room Saloon"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>
            Town <span className="text-sunset">*</span>
          </label>
          <select
            required
            value={form.town}
            onChange={(e) => update("town", e.target.value)}
            className={inputClass}
          >
            <option value="">Select a town</option>
            {TOWNS.map((town) => (
              <option key={town} value={town}>
                {town}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="What should people know about this event?"
            rows={3}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Category</label>
          <select
            value={form.category}
            onChange={(e) => update("category", e.target.value)}
            className={inputClass}
          >
            <option value="">Select a category</option>
            {(
              Object.entries(CATEGORY_LABELS) as [EventCategory, string][]
            ).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Event URL or Website</label>
          <input
            type="text"
            inputMode="url"
            value={form.event_url}
            onChange={(e) => update("event_url", e.target.value)}
            onBlur={() => update("event_url", normalizeUrl(form.event_url))}
            placeholder="mywinery.com"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-stone-light">
            Optional. Your website is fine, no need to type &ldquo;https://&rdquo;.
          </p>
        </div>

        <div>
          <label className={labelClass}>Your Name</label>
          <input
            type="text"
            value={form.submitter_name}
            onChange={(e) => update("submitter_name", e.target.value)}
            placeholder="Optional"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>
            Your Email <span className="text-sunset">*</span>
          </label>
          <input
            type="email"
            required
            value={form.submitter_email}
            onChange={(e) => update("submitter_email", e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-stone-light">
            Required so we can reach you if we have a question about your event
            before it goes up. We won&apos;t share it or add you to any list.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Flyer or Poster</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => onFlyerChange(e.target.files?.[0] ?? null)}
            className="w-full cursor-pointer rounded-lg border border-stone-light/40 bg-white px-3 py-2 text-sm text-forest file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-sage/20 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-pine hover:file:bg-sage/30"
          />
          <p className="mt-1 text-xs text-stone-light">
            Optional. Have a flyer? Attach a JPG, PNG, or WebP (max 4MB) and we may
            use it as the event&apos;s poster.
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-600">{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-forest px-5 py-2.5 text-sm font-medium text-white hover:bg-pine transition-colors disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit Event"}
      </button>
    </form>
  );
}
