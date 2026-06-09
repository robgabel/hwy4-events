import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/constants";
import { faqs } from "@/lib/faqs";

export const metadata: Metadata = {
  title: "Frequently Asked Questions",
  description:
    "Common questions about events along Highway 4 in the Sierra Nevada foothills — Angels Camp, Murphys, Arnold, Bear Valley, and Calaveras County.",
  alternates: { canonical: "/faq" },
};

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
              {faq.cta && (
                <Link
                  href={faq.cta.href}
                  className="mt-2 inline-block text-sm font-medium text-pine hover:underline"
                >
                  {faq.cta.label} &rarr;
                </Link>
              )}
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
