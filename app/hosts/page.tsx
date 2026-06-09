import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/constants";
import HostKit from "@/components/HostKit";

// Landing page for the vacation-rental-host wedge (Karen persona / the B2B2C
// channel in BUSINESS-PLAN.md). Hosts hand the QR card + pre-arrival note to
// already-arriving visitors — the highest-intent "what's on this weekend"
// readers there are. The kit (card + blurb) lives in components/HostKit.tsx;
// the printable card image is app/hosts/card/route.tsx.

export const metadata: Metadata = {
  title: "For Airbnb & Vacation Rental Hosts | Hwy 4 Events",
  description:
    "Give your guests a better weekend on Highway 4. A free QR card and pre-arrival note that show visitors what's happening in Murphys, Arnold, and the rest of the corridor while they're here.",
  alternates: { canonical: "/hosts" },
  openGraph: {
    title: "For Airbnb & Vacation Rental Hosts | Hwy 4 Events",
    description:
      "A free kit to show your guests what's happening on Highway 4 while they're up. Better stays, better reviews, zero work.",
    type: "website",
    url: `${SITE_URL}/hosts`,
  },
};

export const revalidate = 3600;

export default function HostsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
      {/* hero */}
      <p className="font-display text-sm font-semibold uppercase tracking-wide text-sunset">
        For Airbnb &amp; vacation rental hosts
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-forest sm:text-4xl">
        Give your guests a better weekend on the 4
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-stone">
        Your guests booked the cabin. What most of them miss is the live music
        two miles away, the festival in the park, the winery doing music on the
        lawn. We keep the whole corridor&rsquo;s events in one place, updated
        every day. Hand your guests this kit and they have a better trip, which
        means you get a better review. It&rsquo;s free, and it&rsquo;s no work
        for you.
      </p>

      {/* why it works */}
      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          {
            h: "Better stays",
            p: "Guests who find a great Saturday night remember the place they stayed.",
          },
          {
            h: "Better reviews",
            p: "\"The host even told us about a concert down the road\" is a five-star line.",
          },
          {
            h: "Zero upkeep",
            p: "We do the listing. You set out a card and paste one note. That's it.",
          },
        ].map((b) => (
          <div
            key={b.h}
            className="rounded-xl border border-stone-light/30 bg-warm-white p-4"
          >
            <h2 className="font-display text-base font-semibold text-pine">{b.h}</h2>
            <p className="mt-1 text-sm leading-relaxed text-stone">{b.p}</p>
          </div>
        ))}
      </section>

      {/* the kit */}
      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-forest">Your free host kit</h2>
        <p className="mt-2 text-stone">
          Two pieces. Pick your town and they&rsquo;re ready to use.
        </p>
        <div className="mt-6">
          <HostKit />
        </div>
      </section>

      {/* how to use it */}
      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-forest">Where to put it</h2>
        <ul className="mt-4 space-y-3 text-stone">
          <li className="flex gap-3">
            <span aria-hidden className="text-sunset">●</span>
            <span>
              <strong className="text-forest">In the welcome book.</strong> Print
              the card and slip it in the binder, or frame it on the kitchen
              counter. The QR is the first thing a guest scans when they walk in.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="text-sunset">●</span>
            <span>
              <strong className="text-forest">In your check-in message.</strong>{" "}
              Paste the pre-arrival note so guests are looking forward to
              something before they even leave home.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="text-sunset">●</span>
            <span>
              <strong className="text-forest">In your digital guidebook.</strong>{" "}
              Drop in the link:{" "}
              <Link href="/this-weekend" className="font-medium text-pine underline underline-offset-2 hover:text-forest">
                hwy4events.com/this-weekend
              </Link>
              .
            </span>
          </li>
        </ul>
      </section>

      {/* see it */}
      <section className="mt-12 rounded-2xl border border-pine/20 bg-pine/5 p-6 text-center sm:p-8">
        <h2 className="font-display text-xl font-bold text-forest">
          Want to see what your guests will see?
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-stone">
          This is the page every card and link lands on, the whole weekend up
          and down the corridor.
        </p>
        <Link
          href="/this-weekend"
          className="mt-4 inline-block cursor-pointer rounded-lg bg-pine px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-forest"
        >
          See this weekend on the 4 →
        </Link>
      </section>

      {/* contact */}
      <section className="mt-12 border-t border-stone-light/30 pt-8">
        <h2 className="font-display text-lg font-bold text-forest">
          Manage a few rentals? Let&rsquo;s talk.
        </h2>
        <p className="mt-2 text-stone">
          If you run several places, or want a stack of printed cards instead of
          doing it yourself, send a note to{" "}
          <a
            href="mailto:hello@hwy4events.com?subject=Host%20kit%20for%20Highway%204"
            className="font-medium text-pine underline underline-offset-2 hover:text-forest"
          >
            hello@hwy4events.com
          </a>{" "}
          and we&rsquo;ll sort you out. No catch, no cost.
        </p>
      </section>
    </main>
  );
}
