import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Frequently Asked Questions",
  description:
    "Common questions about events along Highway 4 in the Sierra Nevada foothills — Angels Camp, Murphys, Arnold, Bear Valley, and Calaveras County.",
  alternates: { canonical: "/faq" },
};

const faqs = [
  {
    question: "What events are happening this weekend along Highway 4?",
    answer:
      "Hwy 4 Events lists live music, festivals, community events, and resort activities happening in Angels Camp, Murphys, Arnold, Bear Valley, and surrounding towns. Our homepage shows all upcoming events and you can filter by category or town to find exactly what you're looking for.",
  },
  {
    question: "Where can I find live music near Angels Camp or Murphys?",
    answer:
      "Live music is one of the most popular event categories on the Highway 4 corridor. Venues in Murphys, Angels Camp, and Arnold regularly host live bands, singer-songwriters, and open mic nights. Use the 'Live Music' filter on our homepage to see all upcoming performances.",
  },
  {
    question: "What festivals happen in Calaveras County?",
    answer:
      "Calaveras County hosts numerous festivals throughout the year, including the famous Calaveras County Fair & Jumping Frog Jubilee in Angels Camp, Murphys Irish Day, the Arnold Rim Trail Run, seasonal Bear Valley festivals, and many wine and food events along the corridor.",
  },
  {
    question: "Is Bear Valley open for events in summer?",
    answer:
      "Yes! Bear Valley hosts events year-round. While it's best known as a ski resort in winter, summer brings music festivals, outdoor adventure events, farmers markets, and community gatherings. Check our resort category filter to see upcoming Bear Valley events.",
  },
  {
    question: "How often is Hwy 4 Events updated?",
    answer:
      "Our event listings are refreshed daily. We aggregate events from venues, community organizations, and local sources across the Highway 4 corridor to provide the most complete and up-to-date listing available.",
  },
  {
    question: "What towns are included in the Highway 4 corridor?",
    answer:
      "Hwy 4 Events covers the Sierra Nevada foothill towns along California State Route 4 in Calaveras County, including Angels Camp, Murphys, Arnold, Avery, Dorrington, White Pines, and Bear Valley. These towns span from the Gold Country foothills to the Sierra Nevada mountains.",
  },
  {
    question: "Are there member-only events on Hwy 4 Events?",
    answer:
      "Some organizations like the Moose Lodge host member-only events. These are hidden by default but can be revealed by toggling the organization's name in the Member Events section of the filter bar.",
  },
  {
    question: "How do I submit an event to Hwy 4 Events?",
    answer:
      "Hwy 4 Events currently aggregates events from established venues and community organizations along the Highway 4 corridor. If you'd like your venue or organization's events included, please reach out through the community channels listed on the site.",
  },
];

function FAQPageSchema() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

function BreadcrumbSchema() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Hwy 4 Events",
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "FAQ",
        item: `${SITE_URL}/faq`,
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default function FAQPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <FAQPageSchema />
      <BreadcrumbSchema />

      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="text-pine hover:underline">
              Hwy 4 Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-stone-light">FAQ</li>
        </ol>
      </nav>

      <h1 className="font-display mb-2 text-3xl font-bold text-forest">
        Frequently Asked Questions
      </h1>
      <p className="mb-8 text-stone">
        Common questions about events along the Highway 4 corridor in the Sierra
        Nevada foothills.
      </p>

      <div className="space-y-4">
        {faqs.map((faq) => (
          <details
            key={faq.question}
            className="group rounded-xl border border-stone-light/30 bg-white shadow-sm"
          >
            <summary className="cursor-pointer px-5 py-4 text-base font-semibold text-forest hover:text-pine transition-colors">
              {faq.question}
            </summary>
            <div className="px-5 pb-4">
              <p className="leading-relaxed text-stone">{faq.answer}</p>
            </div>
          </details>
        ))}
      </div>

      <div className="mt-10 border-t border-stone-light/30 pt-6">
        <Link
          href="/"
          className="text-sm font-medium text-pine hover:underline"
        >
          &larr; Back to events
        </Link>
      </div>
    </main>
  );
}
