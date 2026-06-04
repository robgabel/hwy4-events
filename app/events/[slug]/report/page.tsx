import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { findEventBySlug } from "@/lib/events";
import ReportEventForm from "@/components/ReportEventForm";

export const revalidate = 3600;

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await findEventBySlug(slug);
  return {
    title: event ? `Suggest a fix: ${event.name}` : "Suggest a fix",
    // A correction form has no business in search results.
    robots: { index: false, follow: true },
  };
}

export default async function ReportEventPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await findEventBySlug(slug);
  if (!event) notFound();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone">
        <ol className="flex flex-wrap items-center gap-1.5">
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
          <li className="text-stone-light">Suggest a fix</li>
        </ol>
      </nav>

      <h1 className="font-display mb-2 text-3xl font-bold text-forest">Suggest a fix</h1>
      <p className="mb-6 text-stone">
        Spot something wrong with{" "}
        <strong className="font-semibold text-forest">{event.name}</strong>, a wrong time, a
        changed lineup, a better poster? Tell us. Nothing changes on the site until we review it.
      </p>

      <ReportEventForm slug={slug} eventName={event.name} />

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
