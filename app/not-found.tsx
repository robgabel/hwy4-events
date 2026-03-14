import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16 text-center">
      <Image
        src="/millie-happy.svg"
        alt="Millie the sheepadoodle looking confused"
        width={120}
        height={120}
        className="opacity-40"
      />
      <h1 className="font-display mt-6 text-2xl font-bold text-forest">
        Millie can&apos;t find that page either
      </h1>
      <p className="mt-2 text-stone">
        It might have moved, or maybe it never existed.
        <br />
        Either way, the events are still happening.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-forest px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pine"
      >
        &larr; Back to all events
      </Link>
    </main>
  );
}
