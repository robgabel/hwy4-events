"use client";

import { useEffect, useState } from "react";

interface EventRow {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  town: string;
  venue_name: string | null;
  address: string | null;
  description: string | null;
  source_name: string | null;
  event_url: string | null;
  dedup_key: string | null;
  sources: unknown;
}

interface Candidate {
  id: string;
  status: string;
  similarity: number;
  reason: string;
  created_at: string;
  event_a_id: string;
  event_b_id: string;
  event_a: EventRow | null;
  event_b: EventRow | null;
}

interface HealthSnapshot {
  snapshot_date: string;
  future_events: number;
  duplicate_groups: number;
  null_address_count: number;
  unknown_venue_count: number;
  candidates_pending: number;
}

function richness(e: EventRow | null): number {
  if (!e) return 0;
  let n = 0;
  if (e.venue_name && !["unknown venue", "unknown", "tbd"].includes(e.venue_name.toLowerCase())) n++;
  if (e.address) n++;
  if (e.description) n++;
  if (e.start_time) n++;
  if (e.event_url) n++;
  return n;
}

function EventCard({ event, isWinner }: { event: EventRow | null; isWinner?: boolean }) {
  if (!event) return <div className="text-sm text-stone-500">(missing)</div>;
  return (
    <div
      className={`rounded border p-3 text-sm ${
        isWinner ? "border-emerald-500 bg-emerald-50" : "border-stone-200 bg-white"
      }`}
    >
      <div className="font-semibold text-stone-900">{event.name}</div>
      <div className="mt-1 text-xs text-stone-500">
        {event.date}
        {event.start_time ? ` · ${event.start_time}` : ""} · {event.town}
      </div>
      <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-stone-500">Venue</dt>
        <dd>{event.venue_name ?? <span className="text-stone-400">—</span>}</dd>
        <dt className="text-stone-500">Address</dt>
        <dd>{event.address ?? <span className="text-stone-400">—</span>}</dd>
        <dt className="text-stone-500">Source</dt>
        <dd>{event.source_name ?? <span className="text-stone-400">—</span>}</dd>
        <dt className="text-stone-500">URL</dt>
        <dd className="truncate">
          {event.event_url ? (
            <a className="text-blue-600 underline" href={event.event_url} target="_blank">
              {event.event_url}
            </a>
          ) : (
            <span className="text-stone-400">—</span>
          )}
        </dd>
        <dt className="text-stone-500">Richness</dt>
        <dd>{richness(event)} / 5</dd>
      </dl>
      {event.description && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-stone-500">description</summary>
          <p className="mt-1 whitespace-pre-wrap text-stone-700">{event.description}</p>
        </details>
      )}
    </div>
  );
}

export default function DuplicatesAdminPage() {
  const [secret, setSecret] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.sessionStorage.getItem("hwy4_admin_key");
    if (saved) setSecret(saved);
  }, []);

  async function load() {
    setError(null);
    setBusy("load");
    try {
      const res = await fetch(`/api/admin/duplicates?key=${encodeURIComponent(secret)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setCandidates(data.candidates ?? []);
      window.sessionStorage.setItem("hwy4_admin_key", secret);

      const hres = await fetch("/api/dedup-health/snapshot");
      if (hres.ok) setHealth((await hres.json()).snapshot ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function act(candidateId: string, action: "merge" | "reject", winnerId?: string) {
    setBusy(candidateId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/duplicates?key=${encodeURIComponent(secret)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_id: candidateId, action, winner_id: winnerId }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-stone-900">Duplicate review queue</h1>
        <p className="mt-1 text-sm text-stone-600">
          Pairs flagged by the nightly detector. Pick the winner (the row that should survive) or
          reject the pair as a false positive.
        </p>
      </header>

      {candidates === null && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Admin key (CRON_SECRET)"
            className="w-72 rounded border border-stone-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={!secret || busy === "load"}
            className="cursor-pointer rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "load" ? "Loading…" : "Load"}
          </button>
        </form>
      )}

      {error && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {health && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              ["Future events", health.future_events],
              ["Dup groups", health.duplicate_groups],
              ["NULL address", health.null_address_count],
              ["Unknown venue", health.unknown_venue_count],
              ["Pending", health.candidates_pending],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded border border-stone-200 bg-white p-3">
              <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
              <div className="mt-1 text-2xl font-semibold text-stone-900">{value}</div>
            </div>
          ))}
        </div>
      )}

      {candidates !== null && candidates.length === 0 && (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          No pending candidates. Nice.
        </div>
      )}

      {candidates !== null && candidates.length > 0 && (
        <ul className="space-y-6">
          {candidates.map((c) => {
            const aRich = richness(c.event_a);
            const bRich = richness(c.event_b);
            const recommendedWinner =
              aRich === bRich ? null : aRich > bRich ? c.event_a_id : c.event_b_id;
            return (
              <li key={c.id} className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                <div className="mb-3 flex items-center justify-between text-xs text-stone-500">
                  <span>
                    Reason: <code className="text-stone-700">{c.reason}</code> · similarity{" "}
                    {c.similarity.toFixed(2)} · flagged{" "}
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <EventCard event={c.event_a} isWinner={recommendedWinner === c.event_a_id} />
                  <EventCard event={c.event_b} isWinner={recommendedWinner === c.event_b_id} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => act(c.id, "merge", c.event_a_id)}
                    className="cursor-pointer rounded border border-emerald-400 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    Keep left, delete right
                  </button>
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => act(c.id, "merge", c.event_b_id)}
                    className="cursor-pointer rounded border border-emerald-400 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    Keep right, delete left
                  </button>
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => act(c.id, "reject")}
                    className="cursor-pointer rounded border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                  >
                    Not a duplicate
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
