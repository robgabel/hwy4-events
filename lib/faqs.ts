// FAQ content, split out of app/faq/page.tsx so it has ONE definition shared by
// the rendered <details> list and the FAQPage JSON-LD (they can't drift), and so
// scripts/voice-lint.ts can import it as plain data (no React/next imports here).
//
// Answers follow content/VOICE.md: answer-first, <=3 sentences, no "Yes!" openers,
// no self-superlatives, and they must agree with the rest of the site (we DO have
// /submit).

export interface SiteFaq {
  question: string;
  answer: string;
  /** Optional internal link rendered under the answer. Not part of the JSON-LD. */
  cta?: { href: string; label: string };
}

export const faqs: SiteFaq[] = [
  {
    question: "What events are happening this weekend along Highway 4?",
    answer:
      "Check the This Weekend view on the homepage; it lists everything from Angels Camp up to Bear Valley with live music, festivals, hikes, kids events, wine, and game nights. Filter by town or category to narrow it down. Listings are refreshed daily.",
    cta: { href: "/this-weekend", label: "See this weekend" },
  },
  {
    question: "Where can I find live music near Angels Camp or Murphys?",
    answer:
      "Use the Live Music filter on the homepage to see every upcoming show on the corridor. Murphys wineries, Angels Camp, and Arnold venues carry most of the lineup. Each listing links to the venue or organizer for set times.",
  },
  {
    question: "What festivals happen in Calaveras County?",
    answer:
      "The big ones are the Calaveras County Fair & Jumping Frog Jubilee in Angels Camp (May), Murphys Irish Day (March), and the Bear Valley summer music run (July to August), plus winery and food events through the season. Filter by the Festival category to see what's dated next.",
  },
  {
    question: "Is Bear Valley open for events in summer?",
    answer:
      "Yes. The Bear Valley Music Festival runs July 17 to August 2 in 2026, and hiking, mountain biking, and the scenic chairlift fill the rest of the season. Filter by Bear Valley on the homepage to see what's on.",
  },
  {
    question: "How often is Hwy 4 Events updated?",
    answer:
      "Listings are refreshed daily from venues, community organizations, and local sources across the corridor. Upcoming events that we can't reconfirm get a small unconfirmed note so you know to call ahead.",
  },
  {
    question: "What towns are included in the Highway 4 corridor?",
    answer:
      "Angels Camp, Copperopolis, Murphys, Avery, Arnold, White Pines, Camp Connell, Dorrington, and Bear Valley, running from the Gold Country foothills up to the Sierra crest. Each town has its own page with what's worth knowing before you go.",
  },
  {
    question: "Are there member-only events on Hwy 4 Events?",
    answer:
      "Some groups like the Moose Lodge and Blue Lake Springs host member events. Those are hidden by default; reveal them by toggling the organization in the Member Events section of the filter bar.",
  },
  {
    question: "How do I submit an event to Hwy 4 Events?",
    answer:
      "Use the submit form and I read every one. If it's a recurring thing, say so and I'll set it to repeat. New venues and community organizations are welcome.",
    cta: { href: "/submit", label: "Submit an event" },
  },
];
