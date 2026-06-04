import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findEventBySlug } from "@/lib/events";
import { posterKind, generatedPosterPath } from "@/lib/poster";
import SubmitPosterForm from "@/components/SubmitPosterForm";

export const metadata: Metadata = {
  title: "Use your own poster — Hwy 4 Events",
  description: "Organizers can swap in their own poster art for their event.",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ slug: string }> };

export default async function SubmitPosterPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await findEventBySlug(slug);
  if (!event) notFound();

  const currentPosterSrc =
    posterKind(event) === "supplied"
      ? (event.image_url as string)
      : generatedPosterPath(slug);
  const hasOwnPoster = posterKind(event) === "supplied";

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
          <li>
            <Link href={`/events/${slug}`} className="text-pine hover:underline">
              {event.name}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-stone-light">Your poster</li>
        </ol>
      </nav>

      <h1 className="font-display mb-2 text-2xl font-bold text-forest">
        Swap in your own poster
      </h1>
      <p className="mb-6 text-stone">
        Running <span className="font-semibold text-forest">{event.name}</span>?
        If you have your own flyer or poster, send it over and we&apos;ll put it on
        the event page in place of the one we made. We show your art as-is, no logos
        or watermarks added.
      </p>

      <div className="mb-8 flex items-start gap-4 rounded-xl border border-stone-light/30 bg-white p-4">
        <div className="w-24 shrink-0 overflow-hidden rounded-lg bg-cream ring-1 ring-stone-light/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentPosterSrc}
            alt={`Current poster for ${event.name}`}
            width={1080}
            height={1350}
            className="block w-full"
            style={{ aspectRatio: "4 / 5", objectFit: "cover" }}
          />
        </div>
        <div className="text-sm text-stone">
          <p className="font-semibold text-forest">On the page now</p>
          <p className="mt-1">
            {hasOwnPoster
              ? "An organizer poster is up. Send a new one to replace it."
              : "This is the poster we made for the event. Yours would take its place."}
          </p>
        </div>
      </div>

      <SubmitPosterForm eventSlug={slug} eventId={event.id} eventName={event.name} />

      <div className="mt-8 border-t border-stone-light/30 pt-6">
        <Link
          href={`/events/${slug}`}
          className="text-sm font-medium text-pine hover:underline"
        >
          &larr; Back to the event
        </Link>
      </div>
    </main>
  );
}
