import type { Metadata } from "next";
import Link from "next/link";
import SubmitEventForm from "@/components/SubmitEventForm";

export const metadata: Metadata = {
  title: "Submit an Event — Hwy 4 Events",
  description:
    "Know about an event along the Highway 4 corridor? Submit it here and we'll add it to the site.",
};

export default function SubmitPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="text-pine hover:underline">
              Hwy 4 Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-stone-light">Submit an Event</li>
        </ol>
      </nav>

      <h1 className="font-display mb-2 text-2xl font-bold text-forest">
        Submit an Event
      </h1>
      <p className="mb-6 text-stone">
        Know about something happening along the Highway 4 corridor? Let us know
        and we&apos;ll get it listed.
      </p>

      <SubmitEventForm />

      <div className="mt-8 border-t border-stone-light/30 pt-6">
        <Link
          href="/"
          className="text-sm font-medium text-pine hover:underline"
        >
          &larr; Back to all events
        </Link>
      </div>
    </main>
  );
}
