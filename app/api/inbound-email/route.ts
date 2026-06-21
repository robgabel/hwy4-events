import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import { NextResponse, after } from "next/server";
import { SITE_URL } from "@/lib/constants";
import { triageSubmissionById } from "@/lib/agent/submission-triage";
import {
  buildExtractionPrompt,
  parseExtractedEvents,
  normalizeExtracted,
  extractEmailAddress,
  escapeLike,
  verifyWebhookSignature,
  type NormalizedEvent,
} from "@/lib/inbound-email";

// Email-to-event ingestion (PRD-email-ingest.md). A curator forwards an
// unstructured event email — often with a poster image — to a dedicated address.
// Resend Inbound parses it and POSTs a signed `email.received` webhook here.
//
// This is just the FRONT DOOR. It reads the email AND the poster (Sonnet) into a
// structured event and lands a `source='email'` PENDING event_submissions row,
// then fires the SAME `triageSubmissionById` that runs on form submissions. From
// there the email rides the shipped Agent Cockpit Stage 1 engine unchanged: the
// agent dup-checks it (shared isSameEvent + web research) and recommends, the
// /admin/submissions UI reviews it, and the existing publish / reversible-merge
// actions decide it (publish pins the poster via image_url + poster_locked).
// Nothing publishes automatically.
//
// IMPORTANT: the Resend webhook is METADATA ONLY — it carries the sender,
// subject, Message-ID, and attachment metadata, but NOT the body or attachment
// bytes. We call back: `resend.emails.receiving.get(email_id)` for the body and
// `resend.emails.receiving.attachments.list({emailId})` for attachments (each
// with a 1-hour `download_url`). See https://resend.com/docs/dashboard/receiving.
//
// The pure decisions (extraction parse, field normalization, signature check)
// live in lib/inbound-email.ts and are unit-tested. This file owns only the
// impure edges: provider signature, the Resend fetch-back, the Storage upload,
// the Anthropic call, and the DB write.

export const maxDuration = 120; // Resend fetch-back + a vision call can be slow

const MODEL = "claude-sonnet-4-6";

// Match the submit form: 4 MB upload ceiling (under Vercel's 4.5 MB body cap),
// JPG/PNG/WebP only. A small floor skips tracking pixels and signature logos.
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MIN_POSTER_BYTES = 8 * 1024;
const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface WebhookMeta {
  emailId: string;
  from: string;
  subject: string;
  messageId: string;
}

interface ReadyAttachment {
  filename: string;
  contentType: string;
  size: number;
  downloadUrl: string;
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Best-effort HTML → text, mirroring the scrapers. Used when the email has no
 *  plain-text part. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse the `email.received` webhook envelope into the metadata we act on before
 *  any fetch-back. Returns null for any other event type or a missing id. This is
 *  the ONLY provider-specific shape; a different inbound provider would adjust
 *  only this function. */
function parseWebhook(payload: unknown): WebhookMeta | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.type !== "email.received") return null;
  const data = (root.data ?? {}) as Record<string, unknown>;
  const emailId = typeof data.email_id === "string" ? data.email_id : "";
  if (!emailId) return null;
  return {
    emailId,
    from: typeof data.from === "string" ? data.from : "",
    subject: typeof data.subject === "string" ? data.subject : "",
    messageId: typeof data.message_id === "string" ? data.message_id : emailId,
  };
}

async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function postSlack(text: string): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("[inbound-email] Slack ping failed:", err);
  }
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    // Refuse to run unauthenticated: without a secret we cannot verify the sender.
    return json({ error: "Inbound email not configured" }, 503);
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const supabase = getServiceClient();
  if (!anthropicKey || !resendKey || !supabase) {
    return json({ error: "Server configuration error" }, 500);
  }

  // Read the raw body BEFORE parsing — the signature is over the exact bytes.
  const raw = await request.text();
  const ok = verifyWebhookSignature({
    secret,
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signatureHeader: request.headers.get("svix-signature"),
    body: raw,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!ok) {
    return json({ error: "Invalid signature" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const meta = parseWebhook(payload);
  if (!meta) {
    return json({ ok: true, ignored: "not an inbound email event" });
  }

  // Curators-only: an allowlist of bare addresses. Unset = no one is allowed
  // (fail closed). Checked from webhook metadata BEFORE any fetch-back, AI, or DB
  // write, so untrusted mail costs nothing.
  const allow = new Set(
    (process.env.INBOUND_EMAIL_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  const fromEmail = extractEmailAddress(meta.from);
  if (!allow.has(fromEmail)) {
    console.warn(`[inbound-email] ignoring non-allowlisted sender: ${fromEmail || "(unknown)"}`);
    return json({ ok: true, ignored: "sender not allowlisted" });
  }

  // Idempotency on Resend's stable email_id; rows are stamped `<email_id>#<index>`.
  const { data: existing } = await supabase
    .from("event_submissions")
    .select("id")
    .like("source_message_id", `${escapeLike(meta.emailId)}#%`)
    .limit(1);
  if (existing && existing.length > 0) {
    return json({ ok: true, deduped: "already processed" });
  }

  // ── Fetch-back: the webhook is metadata-only, so pull the body + attachments. ──
  const resend = new Resend(resendKey);
  const bodyRes = await resend.emails.receiving.get(meta.emailId);
  const attsRes = await resend.emails.receiving.attachments.list({ emailId: meta.emailId });
  if (bodyRes.error && attsRes.error) {
    // Both fetch-backs failed — likely transient. 502 lets Resend retry; the
    // idempotency gate above makes the retry safe.
    console.error("[inbound-email] fetch-back failed:", bodyRes.error, attsRes.error);
    return json({ error: "Could not retrieve email content" }, 502);
  }
  const full = bodyRes.data;
  const bodyText = full?.text?.trim() || (full?.html ? stripHtml(full.html) : "");

  const allAtts: ReadyAttachment[] = (attsRes.data?.data ?? []).map((a) => ({
    filename: a.filename ?? "attachment",
    contentType: (a.content_type ?? "").toLowerCase(),
    size: a.size ?? 0,
    downloadUrl: a.download_url,
  }));

  // Largest qualifying image is the poster candidate; first PDF aids extraction.
  const images = allAtts
    .filter((a) => IMAGE_EXT[a.contentType] && a.size >= MIN_POSTER_BYTES && a.size <= MAX_ATTACHMENT_BYTES)
    .sort((a, b) => b.size - a.size);
  const pdf = allAtts.find(
    (a) => a.contentType === "application/pdf" && a.size > 0 && a.size <= MAX_ATTACHMENT_BYTES
  );
  const droppedImages = Math.max(0, images.length - 1);

  // Upload the poster candidate so Claude gets a public URL (no base64 size
  // ceiling) and we reuse the same URL as the stored poster. Cleaned up below if
  // extraction yields anything other than a single event.
  let posterUrl: string | null = null;
  let posterPath: string | null = null;
  const primary = images[0];
  if (primary) {
    const bytes = await download(primary.downloadUrl);
    if (bytes && bytes.length <= MAX_ATTACHMENT_BYTES) {
      const ext = IMAGE_EXT[primary.contentType];
      const path = `inbound/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("event-posters")
        .upload(path, bytes, { contentType: primary.contentType, upsert: false });
      if (!upErr) {
        posterPath = path;
        posterUrl = supabase.storage.from("event-posters").getPublicUrl(path).data.publicUrl;
      } else {
        console.error("[inbound-email] poster upload failed:", upErr);
      }
    }
  }

  const removePoster = async () => {
    if (posterPath) {
      await supabase.storage.from("event-posters").remove([posterPath]).catch(() => {});
      posterPath = null;
      posterUrl = null;
    }
  };

  // ── Extraction ───────────────────────────────────────────────────────────
  const today = new Date().toISOString().split("T")[0];
  const body = bodyText.slice(0, 8000);
  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: buildExtractionPrompt({ today, subject: meta.subject, body }) },
  ];
  if (posterUrl) {
    content.push({ type: "image", source: { type: "url", url: posterUrl } });
  }
  if (pdf) {
    const pdfBytes = await download(pdf.downloadUrl);
    if (pdfBytes) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: pdfBytes.toString("base64") },
      });
    }
  }

  let normalized: NormalizedEvent[];
  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content }],
    });
    const block = message.content[0];
    const text = block && block.type === "text" ? block.text : "";
    normalized = parseExtractedEvents(text)
      .map((r) => normalizeExtracted(r))
      .filter((e): e is NormalizedEvent => !!e);
  } catch (err) {
    console.error("[inbound-email] extraction failed:", err);
    await removePoster(); // don't leave an orphan upload behind on failure
    return json({ error: "Extraction failed" }, 502);
  }

  if (normalized.length === 0) {
    await removePoster();
    await postSlack(
      `*Inbound email — no event found*\nFrom ${fromEmail}, subject "${meta.subject || "(none)"}". Nothing was queued.`
    );
    return json({ ok: true, events: 0 });
  }

  // A single poster belongs to a single event. For a multi-event email (a season
  // lineup), the image was a reading aid only — drop it rather than pin one flyer
  // onto several different events.
  if (normalized.length !== 1) {
    await removePoster();
  }

  // ── Land pending submissions; the existing triage engine takes it from here. ──
  const receivedAt = new Date().toISOString();
  const rows = normalized.map((e, i) => ({
    event_name: e.name,
    event_date: e.date,
    start_time: e.start_time,
    venue_name: e.venue_name,
    town: e.town ?? "",
    description: e.description,
    category: e.category,
    event_url: null as string | null,
    poster_url: posterUrl, // null unless this is a single-event email
    submitter_name: null as string | null,
    submitter_email: fromEmail,
    source: "email",
    source_message_id: `${meta.emailId}#${i}`,
    raw_email: {
      from: meta.from,
      subject: meta.subject,
      text: body,
      message_id: meta.messageId,
      received_at: receivedAt,
    },
  }));

  const { data: inserted, error: insErr } = await supabase
    .from("event_submissions")
    .insert(rows)
    .select("id");
  if (insErr) {
    // 23505 = the unique source_message_id index fired: a concurrent delivery
    // already inserted these. Treat as success (idempotent); clean up our poster.
    if (insErr.code === "23505") {
      await removePoster();
      return json({ ok: true, deduped: "already processed" });
    }
    console.error("[inbound-email] submission insert failed:", insErr);
    await removePoster();
    return json({ error: "Failed to save submission" }, 500);
  }

  // Fire the agent triage in the background so an opinion (dup check / verdict) is
  // waiting at /admin/submissions, exactly as the submit form does. Best-effort:
  // any failure is recorded on the row and retried by /api/agent/triage-submissions.
  const ids = ((inserted ?? []) as { id: string }[]).map((r) => r.id);
  after(async () => {
    for (const id of ids) {
      try {
        await triageSubmissionById(id);
      } catch (err) {
        console.error("[inbound-email] background triage failed:", err);
      }
    }
  });

  const parts = [
    `*Inbound email — ${rows.length} event${rows.length === 1 ? "" : "s"} queued*`,
    `From ${fromEmail}, subject "${meta.subject || "(none)"}".`,
    posterUrl ? "Poster attached." : null,
    droppedImages > 0 ? `(${droppedImages} extra image${droppedImages === 1 ? "" : "s"} not processed.)` : null,
    `The agent is triaging; review at <${SITE_URL}/admin/submissions|/admin/submissions →>`,
  ].filter(Boolean);
  await postSlack(parts.join("\n"));

  return json({ ok: true, events: rows.length, poster: !!posterUrl });
}
