"use client";

import { useState } from "react";
import Link from "next/link";

// Matches the server cap in app/api/submit-poster/route.ts (Vercel's 4.5 MB body
// limit, minus headroom). Checked client-side too so a too-big file fails fast.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function SubmitPosterForm({
  eventSlug,
  eventId,
  eventName,
}: {
  eventSlug: string;
  eventId: string;
  eventName: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickFile(next: File | null) {
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!next) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!ALLOWED_TYPES.includes(next.type)) {
      setError("Poster must be a JPG, PNG, or WebP image.");
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (next.size > MAX_UPLOAD_BYTES) {
      setError("Poster must be 4MB or smaller.");
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Please choose a poster image to upload.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const body = new FormData();
      body.append("poster", file);
      body.append("event_slug", eventSlug);
      body.append("event_id", eventId);
      body.append("event_name", eventName);
      body.append("submitter_name", name);
      body.append("submitter_email", email);
      body.append("note", note);

      const res = await fetch("/api/submit-poster", { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
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
        <h2 className="font-display text-xl font-semibold text-forest">
          Got it, thank you!
        </h2>
        <p className="mt-2 text-stone">
          We&apos;ll take a look and swap in your poster if it&apos;s a good fit. It
          usually goes up within a day.
        </p>
        <Link
          href={`/events/${eventSlug}`}
          className="mt-6 inline-block text-sm font-medium text-pine hover:underline"
        >
          &larr; Back to the event
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
      <div className="grid gap-4">
        <div>
          <label className={labelClass}>
            Your poster <span className="text-sunset">*</span>
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            className="block w-full cursor-pointer text-sm text-stone file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-forest file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-pine"
          />
          <p className="mt-1 text-xs text-stone-light">
            JPG, PNG, or WebP, up to 4MB. A tall (portrait) image looks best.
          </p>
          {previewUrl && (
            <div className="mt-3 overflow-hidden rounded-lg border border-stone-light/30 bg-cream">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Poster preview"
                className="mx-auto block max-h-80 w-auto"
              />
            </div>
          )}
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
              placeholder="Optional, so we can reach you"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Note</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything we should know? (optional)"
            rows={2}
            className={inputClass}
          />
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-forest px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-pine disabled:opacity-50"
      >
        {submitting ? "Sending..." : "Submit poster"}
      </button>
    </form>
  );
}
